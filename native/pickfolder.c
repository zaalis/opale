/* Opale — folder picker for Linux (GTK 3). Prints the chosen folder on stdout.
 * Exit status 0: a folder was chosen; 1: cancelled. Uses the desktop portal when available. */
#include <gtk/gtk.h>

static void on_response(GtkNativeDialog *dialog, gint response, gpointer data) {
    int *status = data;
    if (response == GTK_RESPONSE_ACCEPT) {
        gchar *folder = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
        if (folder) { g_print("%s\n", folder); g_free(folder); *status = 0; }
    }
    gtk_main_quit();
}

int main(int argc, char **argv) {
    gtk_init(&argc, &argv);
    int status = 1;
    GtkFileChooserNative *dialog = gtk_file_chooser_native_new("Choisissez le dossier du coffre", NULL,
        GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER, "Choisir", "Annuler");
    g_signal_connect(dialog, "response", G_CALLBACK(on_response), &status);
    gtk_native_dialog_show(GTK_NATIVE_DIALOG(dialog));
    gtk_main();
    g_object_unref(dialog);
    return status;
}
