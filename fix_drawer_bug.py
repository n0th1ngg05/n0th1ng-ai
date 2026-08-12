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
    'd:/AI/Chatbot/app/frontend/settings/index.html',
    'd:/AI/Chatbot/app/frontend/studio/index.html'
]

for file in html_files:
    if not os.path.exists(file):
        continue
    
    with open(file, 'r', encoding='utf-8') as f:
        content = f.read()
        
    # Find the exact string </aside> that ends the drawer
    # and replace it with </aside>\n  </div>
    # But only if it's not already followed by </div>!
    # Wait, in some files it might be, let's just use string replacement carefully.
    
    # Let's replace the specific drawer aside end tag.
    target = '</aside>\n\n\n<!-- =========================== HERO'
    if target in content:
        content = content.replace(target, '</aside>\n  </div>\n\n\n<!-- =========================== HERO')
    else:
        # Generic replacement: find </aside> followed by anything that is NOT </div>
        import re
        content = re.sub(r'</aside>\s*(?!</div>)', r'</aside>\n  </div>\n', content, count=1)
        
    with open(file, 'w', encoding='utf-8') as f:
        f.write(content)
        
    print(f"Fixed missing div in {file}")