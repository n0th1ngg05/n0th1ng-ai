import os

html_files = [
    'd:/AI/Chatbot/app/index.html',
    'd:/AI/Chatbot/app/frontend/home/index.html',
    'd:/AI/Chatbot/app/frontend/chatspace/index.html',
    'd:/AI/Chatbot/app/frontend/framesx/index.html',
    'd:/AI/Chatbot/app/frontend/files/index.html',
    'd:/AI/Chatbot/app/frontend/voice/index.html',
    'd:/AI/Chatbot/app/frontend/forge/index.html',
    'd:/AI/Chatbot/app/frontend/forgex/index.html',
    'd:/AI/Chatbot/app/frontend/monitor/index.html',
    'd:/AI/Chatbot/app/frontend/robotics/index.html',
    'd:/AI/Chatbot/app/frontend/settings/index.html'
]

for file in html_files:
    if not os.path.exists(file):
        continue
        
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Inject CSS before </head> if not exists
    if 'nav.css' not in content:
        css_link = '<link rel="stylesheet" href="../assets/nav.css">'
        if file == 'd:/AI/Chatbot/app/index.html':
            css_link = '<link rel="stylesheet" href="frontend/assets/nav.css">'
        content = content.replace('</head>', f'  {css_link}\n</head>')

    # Ensure page-transitions.js exists!
    js_trans = '<script src="../assets/page-transitions.js"></script>'
    if file == 'd:/AI/Chatbot/app/index.html':
        js_trans = '<script src="frontend/assets/page-transitions.js"></script>'
    if 'page-transitions.js' not in content:
        content = content.replace('</body>', f'  {js_trans}\n</body>')
        
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Fixed {file}")