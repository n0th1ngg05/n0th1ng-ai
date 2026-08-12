const fs = require('fs');

const appMenu = `        <div class="nav-dd-menu glass-liquid">
          <a href="frontend/chatspace/index.html"><b>Chatspace</b><i>Ideas &rarr; reality</i></a>
          <a href="frontend/studio/index.html"><b>Image Studio</b><i>Visualize imagination</i></a>
          <a href="frontend/framesx/index.html"><b>FramesX</b><i>Cinematic generation</i></a>
          <a href="frontend/files/index.html"><b>Files</b><i>Knowledge & Documents</i></a>
          <a href="frontend/voice/index.html"><b>Voice Studio</b><i>Speech Intelligence</i></a>
          <a href="frontend/personastudio/index.html"><b>Persona Studio</b><i>NVIDIA PersonaPlex</i></a>
          <a href="frontend/forge/index.html"><b>Forge</b><i>Autonomous build agent</i></a>
          <a href="frontend/forgex/index.html"><b>ForgeX</b><i>Advanced autonomous agentic coding</i></a>
          <a href="frontend/monitor/index.html"><b>Monitor</b><i>Workstation pulse</i></a>
          <a href="frontend/robotics/index.html"><b>Robotics</b><i>Beyond software</i></a>
          <a href="frontend/settings/index.html"><b>Settings</b><i>Configure workspace</i></a>
        </div>`;

const appDrawer = `    <nav class="drawer-links">
      <a href="index.html" data-close>Home <span>&rarr;</span></a>
      <a href="index.html#features" data-close>Features <span>&rarr;</span></a>
      <a href="frontend/chatspace/index.html" data-close>Chatspace <span>&rarr;</span></a>
      <a href="frontend/studio/index.html" data-close>Image Studio <span>&rarr;</span></a>
      <a href="frontend/framesx/index.html" data-close>FramesX <span>&rarr;</span></a>
      <a href="frontend/files/index.html" data-close>Files <span>&rarr;</span></a>
      <a href="frontend/voice/index.html" data-close>Voice Studio <span>&rarr;</span></a>
      <a href="frontend/personastudio/index.html" data-close>Persona Studio <span>&rarr;</span></a>
      <a href="frontend/forge/index.html" data-close>Forge <span>&rarr;</span></a>
      <a href="frontend/forgex/index.html" data-close>ForgeX <span>&rarr;</span></a>
      <a href="frontend/monitor/index.html" data-close>Monitor <span>&rarr;</span></a>
      <a href="frontend/robotics/index.html" data-close>Robotics <span>&rarr;</span></a>
      <a href="index.html#about" data-close>About <span>&rarr;</span></a>
      <a href="frontend/settings/index.html" data-close>Settings <span>&rarr;</span></a>
    </nav>`;

const subMenu = `        <div class="nav-dd-menu glass-liquid">
          <a href="../chatspace/index.html"><b>Chatspace</b><i>Ideas &rarr; reality</i></a>
          <a href="../studio/index.html"><b>Image Studio</b><i>Visualize imagination</i></a>
          <a href="../framesx/index.html"><b>FramesX</b><i>Cinematic generation</i></a>
          <a href="../files/index.html"><b>Files</b><i>Knowledge & Documents</i></a>
          <a href="../voice/index.html"><b>Voice Studio</b><i>Speech Intelligence</i></a>
          <a href="../personastudio/index.html"><b>Persona Studio</b><i>NVIDIA PersonaPlex</i></a>
          <a href="../forge/index.html"><b>Forge</b><i>Autonomous build agent</i></a>
          <a href="../forgex/index.html"><b>ForgeX</b><i>Advanced autonomous agentic coding</i></a>
          <a href="../monitor/index.html"><b>Monitor</b><i>Workstation pulse</i></a>
          <a href="../robotics/index.html"><b>Robotics</b><i>Beyond software</i></a>
          <a href="../settings/index.html"><b>Settings</b><i>Configure workspace</i></a>
        </div>`;

const subDrawer = `      <nav class="drawer-links">
        <a href="../../index.html" data-close>Home <span>&rarr;</span></a>
        <a href="../../index.html#features" data-close>Features <span>&rarr;</span></a>
        <a href="../chatspace/index.html" data-close>Chatspace <span>&rarr;</span></a>
        <a href="../studio/index.html" data-close>Image Studio <span>&rarr;</span></a>
        <a href="../framesx/index.html" data-close>FramesX <span>&rarr;</span></a>
        <a href="../files/index.html" data-close>Files <span>&rarr;</span></a>
        <a href="../voice/index.html" data-close>Voice Studio <span>&rarr;</span></a>
        <a href="../personastudio/index.html" data-close>Persona Studio <span>&rarr;</span></a>
        <a href="../forge/index.html" data-close>Forge <span>&rarr;</span></a>
        <a href="../forgex/index.html" data-close>ForgeX <span>&rarr;</span></a>
        <a href="../monitor/index.html" data-close>Monitor <span>&rarr;</span></a>
        <a href="../robotics/index.html" data-close>Robotics <span>&rarr;</span></a>
        <a href="../../index.html#about" data-close>About <span>&rarr;</span></a>
        <a href="../settings/index.html" data-close>Settings <span>&rarr;</span></a>
      </nav>`;

const files = [
  { path: 'd:/AI/Chatbot/app/index.html', isSub: false },
  { path: 'd:/AI/Chatbot/app/frontend/chatspace/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/files/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/forge/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/forgex/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/monitor/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/personastudio/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/robotics/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/settings/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/studio/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/voice/index.html', isSub: true },
  { path: 'd:/AI/Chatbot/app/frontend/framesx/index.html', isSub: true }
];

const menuRegexPrecise = /<div class="nav-dd-menu[^>]*>[\s\S]*?<\/div>/;
const drawerRegexPrecise = /<nav class="drawer-links">[\s\S]*?<\/nav>/;

files.forEach(f => {
  if (!fs.existsSync(f.path)) return;
  let content = fs.readFileSync(f.path, 'utf8');
  
  let menu = f.isSub ? subMenu : appMenu;
  let drawer = f.isSub ? subDrawer : appDrawer;

  content = content.replace(menuRegexPrecise, menu);
  content = content.replace(drawerRegexPrecise, drawer);
  
  fs.writeFileSync(f.path, content, 'utf8');
  console.log(`Updated ${f.path}`);
});
