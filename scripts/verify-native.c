/* Exercise the production GTK/WebKit shell against the packaged server.
 * gcc scripts/verify-native.c -o dist/opale-native-test $(pkg-config --cflags --libs gtk+-3.0 webkit2gtk-4.1)
 * OPALE_NATIVE_TEST_JS=<absolute script> dbus-run-session -- xvfb-run -a dist/opale-native-test
 */
#define main opale_production_main
#include "../native/opale.c"
#undef main
static int test_status = 1;
static gboolean test_expired(gpointer unused) {
    (void)unused;
    g_printerr("FAIL native validation timed out\n");
    quit_shell();
    return G_SOURCE_REMOVE;
}
static void validation_message(WebKitUserContentManager *manager, WebKitJavascriptResult *result, gpointer unused) {
    (void)manager; (void)unused;
    JSCValue *value = webkit_javascript_result_get_js_value(result);
    gchar *text = jsc_value_to_string(value);
    gboolean dark = TRUE;
    g_object_get(gtk_settings_get_default(), "gtk-application-prefer-dark-theme", &dark, NULL);
    if (g_str_has_prefix(text, "PASS") && !dark) { test_status = 0; g_print("%s\nPASS native GTK theme follows interface\n", text); }
    else g_printerr("FAIL %s (GTK dark=%d)\n", text, dark);
    g_free(text);
    quit_shell();
}
static gboolean install_validation(gpointer unused) {
    (void)unused;
    if (!shell.webview) return G_SOURCE_CONTINUE;
    WebKitUserContentManager *content = webkit_web_view_get_user_content_manager(WEBKIT_WEB_VIEW(shell.webview));
    webkit_user_content_manager_register_script_message_handler(content, "validation");
    g_signal_connect(content, "script-message-received::validation", G_CALLBACK(validation_message), NULL);
    gchar *script = NULL;
    if (!g_file_get_contents(g_getenv("OPALE_NATIVE_TEST_JS"), &script, NULL, NULL)) { g_printerr("FAIL missing validation script\n"); quit_shell(); return G_SOURCE_REMOVE; }
    WebKitUserScript *user = webkit_user_script_new(script, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END, NULL, NULL);
    webkit_user_content_manager_add_script(content, user);
    webkit_user_script_unref(user);
    g_free(script);
    return G_SOURCE_REMOVE;
}
int main(int argc, char **argv) {
    g_timeout_add(10, install_validation, NULL);
    g_timeout_add_seconds(60, test_expired, NULL);
    opale_production_main(argc, argv);
    return test_status;
}
