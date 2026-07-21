// ข้อมูลตัวอย่างชั่วคราวสำหรับทดสอบ UI — ลบออกได้ด้วย clear.js
const fs = require('fs');
const path = require('path');
const DATA = '/Users/anan/Desktop/Claude_Code_Chatbot/data';

const pages = [
  { id: '111', name: 'ร้านกาแฟ Dream Cafe', pictureUrl: '', accessToken: 'TEST', connectedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() },
  { id: '222', name: 'FEFL Shop Official', pictureUrl: '', accessToken: 'TEST', connectedAt: new Date().toISOString(), lastSyncAt: new Date().toISOString() },
];

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();

const conversations = {
  '111': [
    {
      id: 't_1', pageId: '111', pageName: 'ร้านกาแฟ Dream Cafe',
      customerId: 'u1', customerName: 'สมชาย ใจดี',
      updatedTime: iso(5), unreadCount: 2,
      messages: [
        { id: 'm1', text: 'สวัสดีครับ ร้านเปิดกี่โมงครับ', fromId: 'u1', fromName: 'สมชาย ใจดี', isFromPage: false, createdTime: iso(60), attachments: [] },
        { id: 'm2', text: 'สวัสดีค่ะ ร้านเปิด 8 โมงเช้าถึง 2 ทุ่มค่ะ', fromId: '111', fromName: 'ร้านกาแฟ Dream Cafe', isFromPage: true, createdTime: iso(55), attachments: [] },
        { id: 'm3', text: 'มีที่จอดรถไหมครับ', fromId: 'u1', fromName: 'สมชาย ใจดี', isFromPage: false, createdTime: iso(5), attachments: [] },
      ],
    },
    {
      id: 't_2', pageId: '111', pageName: 'ร้านกาแฟ Dream Cafe',
      customerId: 'u2', customerName: 'มะลิ สายหวาน',
      updatedTime: iso(240), unreadCount: 0,
      messages: [
        { id: 'm4', text: 'เค้กวันนี้มีรสอะไรบ้างคะ', fromId: 'u2', fromName: 'มะลิ สายหวาน', isFromPage: false, createdTime: iso(300), attachments: [] },
        { id: 'm5', text: 'วันนี้มีช็อกโกแลต ชาเขียว และมะพร้าวค่ะ', fromId: '111', fromName: 'ร้านกาแฟ Dream Cafe', isFromPage: true, createdTime: iso(240), attachments: [] },
      ],
    },
  ],
  '222': [
    {
      id: 't_3', pageId: '222', pageName: 'FEFL Shop Official',
      customerId: 'u3', customerName: 'Anan P.',
      updatedTime: iso(1), unreadCount: 1,
      messages: [
        { id: 'm6', text: 'สั่งของเมื่อวานได้เลขพัสดุยังครับ', fromId: 'u3', fromName: 'Anan P.', isFromPage: false, createdTime: iso(30), attachments: [] },
        { id: 'm7', text: 'ขอเลขออเดอร์ด้วยค่ะ', fromId: '222', fromName: 'FEFL Shop Official', isFromPage: true, createdTime: iso(20), attachments: [] },
        { id: 'm8', text: 'ORD-10294 ครับ', fromId: 'u3', fromName: 'Anan P.', isFromPage: false, createdTime: iso(1), attachments: [] },
      ],
    },
  ],
};

fs.writeFileSync(path.join(DATA, 'pages.json'), JSON.stringify(pages, null, 2));
fs.writeFileSync(path.join(DATA, 'conversations.json'), JSON.stringify(conversations, null, 2));
console.log('seeded');
