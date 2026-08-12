const fs = require('fs');
let c = fs.readFileSync('d:/AI/Chatbot/app/index.html', 'utf8');

c = c.replace(/Ã¢â‚¬â€ /g, '&mdash;');
c = c.replace(/Ã‚Â·/g, '&middot;');
c = c.replace(/Ã¢â€ â€™/g, '&rarr;');
c = c.replace(/Ãƒâ€”/g, '&times;');
c = c.replace(/<span>\?<\/span>/g, '<span>&rarr;</span>');

fs.writeFileSync('d:/AI/Chatbot/app/index.html', c, 'utf8');
console.log('Fixed index.html encoding.');
