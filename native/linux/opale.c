// Opale for Linux: GTK3/WebKitGTK shell. The Node server remains the single
// implementation of storage and UI; this process owns the server it starts.
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>
#include <glib/gstdio.h>
#include <signal.h>
#include <string.h>

static GPid server_pid = 0;
static WebKitWebView *webview = NULL;

static gchar *opale_home(void) {
  const gchar *override = g_getenv("OPALE_HOME");
  return override && *override ? g_strdup(override) : g_build_filename(g_get_user_config_dir(), "Opale", NULL);
}

static gchar *server_url(void) {
  gchar *home = opale_home();
  gchar *instance = g_build_filename(home, "instance.json", NULL);
  gchar *json = NULL; gsize length = 0; gchar *result = NULL;
  if (g_file_get_contents(instance, &json, &length, NULL)) {
    GRegex *pattern = g_regex_new("\\\"url\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"", 0, 0, NULL);
    GMatchInfo *match = NULL;
    if (g_regex_match(pattern, json, 0, &match)) result = g_match_info_fetch(match, 1);
    g_match_info_free(match); g_regex_unref(pattern); g_free(json);
  }
  g_free(instance); g_free(home); return result;
}

static gboolean load_when_ready(gpointer unused) {
  (void)unused;
  gchar *url = server_url();
  if (!url) return G_SOURCE_CONTINUE;
  webkit_web_view_load_uri(webview, url);
  g_free(url);
  return G_SOURCE_REMOVE;
}

static void start_server(void) {
  gchar *exe = g_file_read_link("/proc/self/exe", NULL);
  gchar *dir = exe ? g_path_get_dirname(exe) : g_get_current_dir();
  gchar *packaged = g_build_filename(dir, "opale-server", NULL);
  gchar *script = g_build_filename(dir, "..", "server.js", NULL);
  gchar *self = exe ? g_strdup(exe) : g_strdup("Opale");
  g_setenv("OPALE_SHELL_EXE", self, TRUE);
  gchar *argv_packaged[] = { packaged, "--port", "0", NULL };
  gchar *argv_dev[] = { "node", script, "--port", "0", NULL };
  GError *error = NULL;
  if (!g_spawn_async(dir, g_file_test(packaged, G_FILE_TEST_IS_EXECUTABLE) ? argv_packaged : argv_dev,
      NULL, G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD, NULL, NULL, &server_pid, &error)) {
    GtkWidget *dialog = gtk_message_dialog_new(NULL, GTK_DIALOG_MODAL, GTK_MESSAGE_ERROR, GTK_BUTTONS_CLOSE,
      "Le serveur Opale n’a pas démarré : %s", error ? error->message : "erreur inconnue");
    gtk_dialog_run(GTK_DIALOG(dialog)); gtk_widget_destroy(dialog); if (error) g_error_free(error);
  }
  g_free(self); g_free(script); g_free(packaged); g_free(dir); g_free(exe);
}

static void on_destroy(GtkWidget *window, gpointer unused) {
  (void)window; (void)unused;
  if (server_pid) { kill(server_pid, SIGTERM); g_spawn_close_pid(server_pid); }
  gtk_main_quit();
}

int main(int argc, char **argv) {
  gtk_init(&argc, &argv);
  start_server();
  GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
  gtk_window_set_title(GTK_WINDOW(window), "Opale");
  gtk_window_set_default_size(GTK_WINDOW(window), 1320, 860);
  gtk_window_set_icon_name(GTK_WINDOW(window), "opale");
  webview = WEBKIT_WEB_VIEW(webkit_web_view_new());
  WebKitSettings *settings = webkit_web_view_get_settings(webview);
  webkit_settings_set_enable_developer_extras(settings, g_getenv("OPALE_DEVTOOLS") != NULL);
  gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(webview));
  g_signal_connect(window, "destroy", G_CALLBACK(on_destroy), NULL);
  gtk_widget_show_all(window);
  g_timeout_add(100, load_when_ready, NULL);
  gtk_main();
  return 0;
}
