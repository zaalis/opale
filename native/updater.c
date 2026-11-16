#include <gtk/gtk.h>
#include <glib-unix.h>
#include <sys/wait.h>
#include <unistd.h>
static GtkWidget *window, *label, *bar;
static gchar *restart;
static gboolean can_close = FALSE;
static gboolean prevent_close(GtkWidget *widget,GdkEvent *event,gpointer data){(void)widget;(void)event;(void)data;return !can_close;}
static gboolean launch(gpointer unused) {
 (void)unused;
 gchar *args[]={restart,NULL};GError *error=NULL;
 if(!g_spawn_async(NULL,args,NULL,G_SPAWN_SEARCH_PATH,NULL,NULL,NULL,&error)){can_close=TRUE;gtk_label_set_text(GTK_LABEL(label),error->message);g_clear_error(&error);return G_SOURCE_REMOVE;}
 gtk_main_quit();return G_SOURCE_REMOVE;
}
static gboolean line(GIOChannel *channel,GIOCondition condition,gpointer unused) {
 (void)unused;gchar *text=NULL;
 if(g_io_channel_read_line(channel,&text,NULL,NULL,NULL)==G_IO_STATUS_NORMAL && text){
  gchar *end=NULL;gint value=strtol(text,&end,10);
  if(end!=text && value>=0 && value<=100){gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(bar),value/100.0);gtk_label_set_text(GTK_LABEL(label),g_strstrip(end));}
  g_free(text);return G_SOURCE_CONTINUE;
 }
 return !(condition&G_IO_HUP);
}
static void finished(GPid pid,gint status,gpointer unused){
 (void)unused;g_spawn_close_pid(pid);
 if(WIFEXITED(status)&&WEXITSTATUS(status)==0){gtk_progress_bar_set_fraction(GTK_PROGRESS_BAR(bar),1);gtk_label_set_text(GTK_LABEL(label),"Redémarrage en cours");g_timeout_add(700,launch,NULL);}
 else {can_close=TRUE;gtk_label_set_text(GTK_LABEL(label),"La mise à jour n'a pas pu se terminer. Fermez cette fenêtre et relancez Opale.");}
}
int main(int argc,char **argv){
 if(argc!=9)return 2;
 restart=g_strdup(argv[8]);
 gtk_init(NULL,NULL);g_object_set(gtk_settings_get_default(),"gtk-application-prefer-dark-theme",TRUE,NULL);
 window=gtk_window_new(GTK_WINDOW_TOPLEVEL);gtk_window_set_title(GTK_WINDOW(window),"Mise à jour Opale");gtk_window_set_default_size(GTK_WINDOW(window),440,150);gtk_container_set_border_width(GTK_CONTAINER(window),24);
 GtkWidget *box=gtk_box_new(GTK_ORIENTATION_VERTICAL,18);gtk_container_add(GTK_CONTAINER(window),box);
 label=gtk_label_new("Installation de la dernière version d'Opale");gtk_label_set_line_wrap(GTK_LABEL(label),TRUE);gtk_box_pack_start(GTK_BOX(box),label,TRUE,TRUE,0);
 bar=gtk_progress_bar_new();gtk_box_pack_start(GTK_BOX(box),bar,FALSE,FALSE,0);g_signal_connect(window,"delete-event",G_CALLBACK(prevent_close),NULL);g_signal_connect(window,"destroy",G_CALLBACK(gtk_main_quit),NULL);gtk_widget_show_all(window);
 gchar *args[]={argv[1],argv[2],argv[3],argv[4],argv[5],argv[6],argv[7],NULL};
 GPid child;gint output;GError *error=NULL;
 if(!g_spawn_async_with_pipes(NULL,args,NULL,G_SPAWN_DO_NOT_REAP_CHILD,NULL,NULL,&child,NULL,&output,NULL,&error)){can_close=TRUE;gtk_label_set_text(GTK_LABEL(label),error->message);g_clear_error(&error);}
 else{GIOChannel *channel=g_io_channel_unix_new(output);g_io_channel_set_close_on_unref(channel,TRUE);g_io_add_watch(channel,G_IO_IN|G_IO_HUP,line,NULL);g_io_channel_unref(channel);g_child_watch_add(child,finished,NULL);}
 gtk_main();g_free(restart);return 0;
}
