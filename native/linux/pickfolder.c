#include <gtk/gtk.h>
int main(int argc, char **argv) {
  gtk_init(&argc, &argv);
  GtkWidget *dialog = gtk_file_chooser_dialog_new("Choisissez le dossier du coffre", NULL,
    GTK_FILE_CHOOSER_ACTION_SELECT_FOLDER, "Annuler", GTK_RESPONSE_CANCEL, "Choisir", GTK_RESPONSE_ACCEPT, NULL);
  if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
    char *folder = gtk_file_chooser_get_filename(GTK_FILE_CHOOSER(dialog));
    g_print("%s", folder); g_free(folder);
  }
  gtk_widget_destroy(dialog); return 0;
}
