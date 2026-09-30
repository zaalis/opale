/* =====================================================================
 *  Opale — native Linux shell (GTK 3 + WebKitGTK)
 *  - One instance per user (GApplication): a second launch raises the first.
 *  - Attaches to an Opale server that is already running, or starts one
 *    (opale-server beside this executable, or Node on ../server.js in a
 *    development checkout). The child dies with the window.
 *  - The server picks its own port and publishes it in
 *    $XDG_CONFIG_HOME/Opale/instance.json (~/.config/Opale); the shell reads it there.
 *  Build: native/build.sh
 * ===================================================================== */
#define _GNU_SOURCE
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <glib-unix.h>
#include <glib/gstdio.h>
#include <sys/prctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define APP_ID "io.zaalis.Opale"
#if GLIB_CHECK_VERSION(2, 74, 0)
#define APP_FLAGS G_APPLICATION_DEFAULT_FLAGS
#else
#define APP_FLAGS G_APPLICATION_FLAGS_NONE
#endif
#define WINDOW_TITLE "Opale"
#define WAIT_TIMEOUT_MS 25000
#define POLL_MS 150

typedef struct {
    GtkApplication *app;
    GtkWidget *window;
    GtkWidget *webview;
    gchar *home;          /* ~/.config/Opale */
    gchar *origin;        /* http://127.0.0.1:<port> */
    gchar *self_dir;      /* folder of this executable */
    gchar *self_path;
    pid_t child;          /* the server this shell started (0 once it has exited, or if attached to another) */
    gboolean child_exited;
    gboolean owns_server; /* the page shows the server this shell started */
    gint waited_ms;
    gboolean quitting;
} Shell;

static Shell shell;

/* ------------------------------------------------------------------ helpers */

static gchar *opale_home(void) {
    const gchar *custom = g_getenv("OPALE_HOME");
    if (custom && *custom) return g_canonicalize_filename(custom, NULL);
    const gchar *config = g_getenv("XDG_CONFIG_HOME");
    if (config && *config) return g_build_filename(config, "Opale", NULL);
    return g_build_filename(g_get_home_dir(), ".config", "Opale", NULL);
}

static long json_int(const char *json, const char *name) {
    gchar *key = g_strdup_printf("\"%s\"", name);
    const char *at = strstr(json, key);
    g_free(key);
    if (!at) return 0;
    at = strchr(at, ':');
    return at ? strtol(at + 1, NULL, 10) : 0;
}

typedef struct { int port; pid_t pid; } Instance;

static gboolean read_instance(Instance *out) {
    gchar *file = g_build_filename(shell.home, "instance.json", NULL);
    gchar *contents = NULL; gsize length = 0;
    gboolean ok = FALSE;
    if (g_file_get_contents(file, &contents, &length, NULL) && length < 64 * 1024) {
        long port = json_int(contents, "port"), pid = json_int(contents, "pid");
        if (port > 0 && port < 65536 && pid > 0) { out->port = (int)port; out->pid = (pid_t)pid; ok = TRUE; }
    }
    g_free(contents); g_free(file);
    return ok;
}

static gboolean process_alive(pid_t pid) {
    if (pid <= 0) return FALSE;
    return kill(pid, 0) == 0 || errno == EPERM;
}

static gboolean port_open(int port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return FALSE;
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons((uint16_t)port);
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr);
    gboolean open_ = connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0;
    close(fd);
    return open_;
}

static void show_error(const gchar *message, const gchar *detail) {
    GtkWidget *dialog = gtk_message_dialog_new(shell.window ? GTK_WINDOW(shell.window) : NULL, GTK_DIALOG_MODAL,
        GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE, "%s", message);
    if (detail) gtk_message_dialog_format_secondary_text(GTK_MESSAGE_DIALOG(dialog), "%s", detail);
    gtk_window_set_title(GTK_WINDOW(dialog), WINDOW_TITLE);
    gtk_dialog_run(GTK_DIALOG(dialog));
    gtk_widget_destroy(dialog);
}

/* ------------------------------------------------------------ server child */

static gboolean file_is_executable(const gchar *path) {
    return g_file_test(path, G_FILE_TEST_IS_REGULAR) && access(path, X_OK) == 0;
}

/* Starts the server as a child that dies with this process. Returns its pid (0 on failure). */
static pid_t launch_server(void) {
    gchar *packaged = g_build_filename(shell.self_dir, "opale-server", NULL);
    gchar *script = g_build_filename(shell.self_dir, "..", "server.js", NULL);
    gchar *script_dist = g_build_filename(shell.self_dir, "..", "..", "server.js", NULL);
    const gchar *argv[4] = { NULL, NULL, NULL, NULL };
    gchar *node = NULL, *script_real = NULL;

    if (file_is_executable(packaged)) {
        argv[0] = packaged;
    } else {
        /* A development checkout: project/server.js (shell in project/ or project/dist/). */
        script_real = g_file_test(script, G_FILE_TEST_EXISTS) ? g_canonicalize_filename(script, NULL)
                    : g_file_test(script_dist, G_FILE_TEST_EXISTS) ? g_canonicalize_filename(script_dist, NULL) : NULL;
        node = g_find_program_in_path("node");
        if (!script_real || !node) { g_free(packaged); g_free(script); g_free(script_dist); g_free(script_real); g_free(node); return 0; }
        argv[0] = node; argv[1] = script_real;
    }

    pid_t parent = getpid();
    gchar *pid_text = g_strdup_printf("%d", (int)parent);
    pid_t child = fork();
    if (child == 0) {
        /* The server stops with us, even if we crash. */
        prctl(PR_SET_PDEATHSIG, SIGTERM);
        if (getppid() != parent) _exit(0);
        setsid();
        int null = open("/dev/null", O_RDWR);
        if (null >= 0) { dup2(null, 0); dup2(null, 1); dup2(null, 2); if (null > 2) close(null); }
        setenv("OPALE_SHELL_EXE", shell.self_path, 1);   /* lets the server record how to start Opale again */
        setenv("OPALE_PARENT_PID", pid_text, 1);
        execv(argv[0], (char *const *)argv);
        _exit(127);
    }
    g_free(pid_text); g_free(packaged); g_free(script); g_free(script_dist); g_free(script_real); g_free(node);
    return child > 0 ? child : 0;
}

static void stop_server(void) {
    pid_t victim = shell.child;
    if (victim <= 0) return;
    shell.child = 0;
    kill(victim, SIGTERM);                 /* the server closes cleanly and removes instance.json */
    gboolean gone = FALSE;
    for (int i = 0; i < 40 && !gone; i++) {
        if (waitpid(victim, NULL, WNOHANG) != 0) gone = TRUE; else g_usleep(50 * 1000);
    }
    if (!gone) { kill(victim, SIGKILL); waitpid(victim, NULL, 0); }
    Instance inst;
    if (read_instance(&inst) && inst.pid == victim) {
        gchar *file = g_build_filename(shell.home, "instance.json", NULL);
        g_unlink(file); g_free(file);
    }
}

/* ------------------------------------------------------------- web view */

static gboolean is_app_uri(const gchar *uri) {
    if (!uri || !shell.origin) return FALSE;
    gsize n = strlen(shell.origin);
    return strncmp(uri, shell.origin, n) == 0 && (uri[n] == '\0' || uri[n] == '/');
}

static void open_externally(const gchar *uri) {
    if (!uri) return;
    if (g_str_has_prefix(uri, "http://") || g_str_has_prefix(uri, "https://") || g_str_has_prefix(uri, "mailto:"))
        g_app_info_launch_default_for_uri(uri, NULL, NULL);
}

/* Links to the web open in the default browser, never in this window. */
static gboolean on_decide_policy(WebKitWebView *view, WebKitPolicyDecision *decision, WebKitPolicyDecisionType type, gpointer data) {
    (void)view; (void)data;
    if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION || type == WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION) {
        WebKitNavigationPolicyDecision *navigation = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
        WebKitNavigationAction *action = webkit_navigation_policy_decision_get_navigation_action(navigation);
        WebKitURIRequest *request = webkit_navigation_action_get_request(action);
        const gchar *uri = webkit_uri_request_get_uri(request);
        if (type == WEBKIT_POLICY_DECISION_TYPE_NAVIGATION_ACTION &&
            (is_app_uri(uri) || g_str_has_prefix(uri, "about:") || g_str_has_prefix(uri, "blob:") || g_str_has_prefix(uri, "data:"))) {
            webkit_policy_decision_use(decision);
        } else {
            webkit_policy_decision_ignore(decision);
            open_externally(uri);
        }
        return TRUE;
    }
    if (type == WEBKIT_POLICY_DECISION_TYPE_RESPONSE) {
        WebKitResponsePolicyDecision *response = WEBKIT_RESPONSE_POLICY_DECISION(decision);
        if (!webkit_response_policy_decision_is_mime_type_supported(response)) { webkit_policy_decision_download(decision); return TRUE; }
        return FALSE;
    }
    return FALSE;
}

/* The interface draws its own menus. */
static gboolean on_context_menu(WebKitWebView *view, WebKitContextMenu *menu, GdkEvent *event, WebKitHitTestResult *hit, gpointer data) {
    (void)view; (void)menu; (void)event; (void)hit; (void)data;
    return TRUE;
}

/* The page may use the clipboard (Opale's own "Coller" menu); nothing else is granted. */
static gboolean on_permission(WebKitWebView *view, WebKitPermissionRequest *request, gpointer data) {
    (void)data;
    if (is_app_uri(webkit_web_view_get_uri(view))) webkit_permission_request_allow(request);
    else webkit_permission_request_deny(request);
    return TRUE;
}

static void on_download_destination_chosen(GtkNativeDialog *dialog, gint response, gpointer download) {
    if (response == GTK_RESPONSE_ACCEPT) {
        gchar *file = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (file) { gchar *uri = g_filename_to_uri(file, NULL, NULL); if (uri) webkit_download_set_destination(download, uri); g_free(uri); g_free(file); }
    } else {
        webkit_download_cancel(download);
    }
    g_object_unref(dialog);
    g_object_unref(download);
}

static gboolean on_download_name(WebKitDownload *download, const gchar *suggested, gpointer data) {
    (void)data;
    GtkFileChooserNative *dialog = gtk_file_chooser_native_new("Enregistrer le fichier", GTK_WINDOW(shell.window),
        GTK_FILE_CHOOSER_ACTION_SAVE, "Enregistrer", "Annuler");
    gtk_file_chooser_set_do_overwrite_confirmation(GTK_FILE_CHOOSER(dialog), TRUE);
    gtk_file_chooser_set_current_name(GTK_FILE_CHOOSER(dialog), suggested && *suggested ? suggested : "fichier");
    g_object_ref(download);
    g_signal_connect(dialog, "response", G_CALLBACK(on_download_destination_chosen), download);
    gtk_native_dialog_show(GTK_NATIVE_DIALOG(dialog));
    return TRUE;
}

static void on_download_started(WebKitWebContext *context, WebKitDownload *download, gpointer data) {
    (void)context; (void)data;
    g_signal_connect(download, "decide-destination", G_CALLBACK(on_download_name), NULL);
}

static void on_title_changed(WebKitWebView *view, GParamSpec *spec, gpointer data) {
    (void)spec; (void)data;
    const gchar *title = webkit_web_view_get_title(view);
    gtk_window_set_title(GTK_WINDOW(shell.window), title && *title ? title : WINDOW_TITLE);
}

/* The window follows the theme chosen in Opale (light or dark). */
static void on_theme_message(WebKitUserContentManager *manager, WebKitJavascriptResult *result, gpointer data) {
    (void)manager; (void)data;
    JSCValue *value = webkit_javascript_result_get_js_value(result);
    if (!jsc_value_is_object(value)) return;
    JSCValue *theme = jsc_value_object_get_property(value, "theme");
    if (theme && jsc_value_is_string(theme)) {
        gchar *name = jsc_value_to_string(theme);
        gboolean light = g_strcmp0(name, "light") == 0;
        g_object_set(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", !light, NULL);
        GdkRGBA background; gdk_rgba_parse(&background, light ? "#faf9f7" : "#1e1d25");
        webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(shell.webview), &background);
        g_free(name);
    }
    if (theme) g_object_unref(theme);
}

/* ---------------------------------------------------------- window state */

static gchar *state_file(void) { return g_build_filename(shell.home, "window.ini", NULL); }

static void save_window_state(void) {
    if (!shell.window) return;
    GKeyFile *keys = g_key_file_new();
    gboolean maximized = gtk_window_is_maximized(GTK_WINDOW(shell.window));
    g_key_file_set_boolean(keys, "window", "maximized", maximized);
    if (!maximized) {
        gint width, height;
        gtk_window_get_size(GTK_WINDOW(shell.window), &width, &height);
        g_key_file_set_integer(keys, "window", "width", width);
        g_key_file_set_integer(keys, "window", "height", height);
    } else {
        /* Keep the last normal size from the previous run. */
        gchar *file = state_file();
        GKeyFile *old = g_key_file_new();
        if (g_key_file_load_from_file(old, file, G_KEY_FILE_NONE, NULL)) {
            g_key_file_set_integer(keys, "window", "width", g_key_file_get_integer(old, "window", "width", NULL));
            g_key_file_set_integer(keys, "window", "height", g_key_file_get_integer(old, "window", "height", NULL));
        }
        g_key_file_free(old); g_free(file);
    }
    g_mkdir_with_parents(shell.home, 0700);
    gchar *file = state_file();
    g_key_file_save_to_file(keys, file, NULL);
    g_free(file); g_key_file_free(keys);
}

static void restore_window_state(GtkWindow *window) {
    gint width = 1320, height = 860; gboolean maximized = FALSE;
    gchar *file = state_file();
    GKeyFile *keys = g_key_file_new();
    if (g_key_file_load_from_file(keys, file, G_KEY_FILE_NONE, NULL)) {
        gint w = g_key_file_get_integer(keys, "window", "width", NULL), h = g_key_file_get_integer(keys, "window", "height", NULL);
        if (w >= 720 && h >= 480 && w < 10000 && h < 10000) { width = w; height = h; }
        maximized = g_key_file_get_boolean(keys, "window", "maximized", NULL);
    }
    g_key_file_free(keys); g_free(file);
    gtk_window_set_default_size(window, width, height);
    if (maximized) gtk_window_maximize(window);
}

/* ---------------------------------------------------------- window events */

static void quit_shell(void) {
    if (shell.quitting) return;
    shell.quitting = TRUE;
    save_window_state();
    stop_server();
    if (shell.app) g_application_quit(G_APPLICATION(shell.app));
}

static gboolean on_delete(GtkWidget *widget, GdkEvent *event, gpointer data) {
    (void)widget; (void)event; (void)data;
    quit_shell();
    return FALSE;
}

/* F11 toggles full screen and Ctrl+Q quits, as in any Linux application. Everything else goes to Opale. */
static gboolean on_key(GtkWidget *widget, GdkEventKey *event, gpointer data) {
    (void)data;
    GdkWindow *gdk = gtk_widget_get_window(widget);
    if (event->keyval == GDK_KEY_F11) {
        gboolean full = gdk && (gdk_window_get_state(gdk) & GDK_WINDOW_STATE_FULLSCREEN);
        if (full) gtk_window_unfullscreen(GTK_WINDOW(widget)); else gtk_window_fullscreen(GTK_WINDOW(widget));
        return TRUE;
    }
    if ((event->state & GDK_CONTROL_MASK) && !(event->state & (GDK_MOD1_MASK | GDK_SHIFT_MASK)) && (event->keyval == GDK_KEY_q || event->keyval == GDK_KEY_Q)) {
        quit_shell();
        return TRUE;
    }
    return FALSE;
}

static gboolean on_signal(gpointer data) {
    (void)data;
    quit_shell();
    return G_SOURCE_REMOVE;
}

/* ------------------------------------------------------- server start-up */

static void load_app(int port) {
    shell.origin = g_strdup_printf("http://127.0.0.1:%d", port);
    webkit_web_view_load_uri(WEBKIT_WEB_VIEW(shell.webview), shell.origin);
}

static void fail_to_start(void) {
    show_error("Le serveur d’Opale n’a pas démarré.",
               "Vérifiez que opale-server se trouve à côté de l’application (ou que Node.js est installé pour une version de développement).");
    quit_shell();
}

/* Once the page shows our own server, notice if it dies instead of leaving a blank window. */
static gboolean watch_child(gpointer data) {
    (void)data;
    if (shell.quitting || shell.child <= 0) return G_SOURCE_REMOVE;
    if (waitpid(shell.child, NULL, WNOHANG) == shell.child) {
        shell.child = 0; shell.child_exited = TRUE;
        shell.quitting = TRUE;
        show_error("Opale s’est arrêté.", "Le serveur local s’est arrêté. Relancez Opale.");
        save_window_state();
        if (shell.app) g_application_quit(G_APPLICATION(shell.app));
        return G_SOURCE_REMOVE;
    }
    return G_SOURCE_CONTINUE;
}

/* Polls until a server is ready, without blocking the window. */
static gboolean poll_server(gpointer data) {
    (void)data;
    if (shell.quitting) return G_SOURCE_REMOVE;
    if (shell.child > 0 && waitpid(shell.child, NULL, WNOHANG) == shell.child) { shell.child = 0; shell.child_exited = TRUE; }

    Instance inst;
    if (read_instance(&inst)) {
        /* Only the file written by our own child counts: a stale one could name a port that now belongs to another program. */
        if (shell.child > 0 && inst.pid == shell.child && port_open(inst.port)) {
            shell.owns_server = TRUE;
            load_app(inst.port);
            g_timeout_add(500, watch_child, NULL);
            return G_SOURCE_REMOVE;
        }
        /* The server found another instance and left: use that one. */
        if (shell.child_exited && process_alive(inst.pid) && port_open(inst.port)) { load_app(inst.port); return G_SOURCE_REMOVE; }
    }
    shell.waited_ms += POLL_MS;
    if (shell.child_exited || shell.waited_ms >= WAIT_TIMEOUT_MS) { fail_to_start(); return G_SOURCE_REMOVE; }
    return G_SOURCE_CONTINUE;
}

static void start_server(void) {
    Instance inst;
    if (read_instance(&inst) && process_alive(inst.pid) && port_open(inst.port)) { load_app(inst.port); return; }
    shell.child = launch_server();
    if (!shell.child) { fail_to_start(); return; }
    g_timeout_add(POLL_MS, poll_server, NULL);
}

/* ------------------------------------------------------------ application */

static void apply_css(void) {
    GtkCssProvider *css = gtk_css_provider_new();
    gtk_css_provider_load_from_data(css, "window { background-color: #131218; }", -1, NULL);
    gtk_style_context_add_provider_for_screen(gdk_screen_get_default(), GTK_STYLE_PROVIDER(css), GTK_STYLE_PROVIDER_PRIORITY_APPLICATION);
    g_object_unref(css);
}

static void set_icon(void) {
    gtk_window_set_default_icon_name("opale");
    /* Not installed yet (running from the build folder): use the PNG beside the executable. */
    gchar *png = g_build_filename(shell.self_dir, "opale.png", NULL);
    if (g_file_test(png, G_FILE_TEST_EXISTS)) gtk_window_set_default_icon_from_file(png, NULL);
    g_free(png);
}

static void build_window(GtkApplication *app) {
    apply_css();
    set_icon();
    g_object_set(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", TRUE, NULL);

    shell.window = gtk_application_window_new(app);
    gtk_window_set_title(GTK_WINDOW(shell.window), WINDOW_TITLE);
    gtk_window_set_position(GTK_WINDOW(shell.window), GTK_WIN_POS_CENTER);
    gtk_widget_set_size_request(shell.window, 720, 480);
    restore_window_state(GTK_WINDOW(shell.window));

    /* Persistent storage for the page (settings kept in localStorage). */
    gchar *data_dir = g_build_filename(g_get_user_data_dir(), "Opale", "webkit", NULL);
    gchar *cache_dir = g_build_filename(g_get_user_cache_dir(), "Opale", "webkit", NULL);
    WebKitWebsiteDataManager *manager = webkit_website_data_manager_new("base-data-directory", data_dir, "base-cache-directory", cache_dir, NULL);
    WebKitWebContext *context = webkit_web_context_new_with_website_data_manager(manager);
    g_free(data_dir); g_free(cache_dir);
    g_signal_connect(context, "download-started", G_CALLBACK(on_download_started), NULL);

    WebKitUserContentManager *content = webkit_user_content_manager_new();
    webkit_user_content_manager_register_script_message_handler(content, "opale");
    g_signal_connect(content, "script-message-received::opale", G_CALLBACK(on_theme_message), NULL);

    shell.webview = g_object_new(WEBKIT_TYPE_WEB_VIEW, "web-context", context, "user-content-manager", content, NULL);
    WebKitSettings *settings = webkit_web_view_get_settings(WEBKIT_WEB_VIEW(shell.webview));
    webkit_settings_set_enable_developer_extras(settings, g_getenv("OPALE_DEVTOOLS") != NULL);
    webkit_settings_set_enable_smooth_scrolling(settings, TRUE);
    webkit_settings_set_javascript_can_access_clipboard(settings, TRUE);

    GdkRGBA background; gdk_rgba_parse(&background, "#1e1d25");
    webkit_web_view_set_background_color(WEBKIT_WEB_VIEW(shell.webview), &background);

    g_signal_connect(shell.webview, "decide-policy", G_CALLBACK(on_decide_policy), NULL);
    g_signal_connect(shell.webview, "context-menu", G_CALLBACK(on_context_menu), NULL);
    g_signal_connect(shell.webview, "permission-request", G_CALLBACK(on_permission), NULL);
    g_signal_connect(shell.webview, "notify::title", G_CALLBACK(on_title_changed), NULL);
    g_signal_connect(shell.window, "delete-event", G_CALLBACK(on_delete), NULL);
    g_signal_connect(shell.window, "key-press-event", G_CALLBACK(on_key), NULL);

    gtk_container_add(GTK_CONTAINER(shell.window), shell.webview);
    gtk_widget_show_all(shell.window);
    gtk_widget_grab_focus(shell.webview);
    g_object_unref(context);
    g_object_unref(content);
}

static void on_activate(GtkApplication *app, gpointer data) {
    (void)data;
    if (shell.window) { gtk_window_present(GTK_WINDOW(shell.window)); return; }   /* second launch: raise the first window */
    build_window(app);
    start_server();
}

int main(int argc, char **argv) {
    gchar *self = g_file_read_link("/proc/self/exe", NULL);
    shell.self_path = self ? self : g_strdup(argv[0]);
    shell.self_dir = g_path_get_dirname(shell.self_path);
    shell.home = opale_home();

    g_set_prgname("opale");
    g_set_application_name(WINDOW_TITLE);

    shell.app = gtk_application_new(APP_ID, APP_FLAGS);
    g_signal_connect(shell.app, "activate", G_CALLBACK(on_activate), NULL);
    g_unix_signal_add(SIGINT, on_signal, NULL);
    g_unix_signal_add(SIGTERM, on_signal, NULL);

    int status = g_application_run(G_APPLICATION(shell.app), argc, argv);
    stop_server();
    g_object_unref(shell.app);
    return status;
}
