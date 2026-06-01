const { Menu } = require("electron");
const { isMac, productName } = require("./constants.cjs");

const installApplicationMenu = ({
  closeMainWindow,
  createSettingsWindow,
  launchVaexcoreSuite,
}) => {
  const template = [
    {
      label: isMac ? productName : "File",
      submenu: [
        ...(isMac ? [{ role: "about" }, { type: "separator" }] : []),
        {
          label: "Configuration Settings...",
          accelerator: "CommandOrControl+,",
          click: () => {
            void createSettingsWindow();
          },
        },
        {
          label: "Launch vaexcore Suite",
          click: () => launchVaexcoreSuite(),
        },
        { type: "separator" },
        {
          label: "Close Window (App Keeps Running)",
          accelerator: "CommandOrControl+W",
          click: () => closeMainWindow(),
        },
        {
          label: "Quit App (Stops Local Server)",
          accelerator: "CommandOrControl+Q",
          click: () => require("electron").app.quit(),
        },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

module.exports = { installApplicationMenu };
