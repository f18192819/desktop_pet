import { app, dialog } from 'electron';
import { startApp } from './main';

startApp().catch(error => {
  console.error(error);
  dialog.showErrorBox('艾玛启动失败', error instanceof Error ? error.message : String(error));
  app.quit();
});
