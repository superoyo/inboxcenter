// ข้อมูลตั้งต้นแบบกำหนดค่าแน่นอน (deterministic) สำหรับ smoke test
// ไม่มี timestamp ที่ขึ้นกับ "วันนี้" ในค่าที่ต้องเทียบ — ตัวรันจะ normalize ให้อีกชั้น
export const CHANNEL_SECRET = 'smoke_secret';

export const fixtures = {
  'pages.json': [
    {
      id: '100000000000001',
      name: 'Smoke FB Page',
      pictureUrl: '',
      accessToken: 'FAKE_FB_TOKEN',
      connectedAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: '2026-01-02T00:00:00.000Z',
    },
    {
      id: 'line_smokechan',
      platform: 'line',
      name: 'Smoke LINE OA',
      pictureUrl: '',
      basicId: '@smoke',
      channelId: 'smokechan',
      channelSecret: CHANNEL_SECRET,
      accessToken: 'FAKE_LINE_TOKEN',
      connectedAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: null,
    },
  ],

  'conversations.json': {
    '100000000000001': [
      {
        id: 't_smoke_1',
        pageId: '100000000000001',
        pageName: 'Smoke FB Page',
        customerId: 'cust_1',
        customerName: 'ลูกค้า ทดสอบ',
        customerPic: '',
        updatedTime: '2026-01-05T03:00:00.000Z',
        unreadCount: 1,
        messages: [
          {
            id: 'm1',
            text: 'สวัสดีค่ะ สอบถามราคาสินค้า',
            fromId: 'cust_1',
            fromName: 'ลูกค้า ทดสอบ',
            isFromPage: false,
            createdTime: '2026-01-05T02:00:00.000Z',
            attachments: [],
          },
          {
            id: 'm2',
            text: 'สวัสดีครับ ยินดีให้บริการครับ',
            fromId: '100000000000001',
            fromName: 'Smoke FB Page',
            isFromPage: true,
            createdTime: '2026-01-05T02:00:30.000Z',
            attachments: [],
          },
          {
            id: 'm3',
            text: 'ขอใบเสนอราคาด้วยค่ะ',
            fromId: 'cust_1',
            fromName: 'ลูกค้า ทดสอบ',
            isFromPage: false,
            createdTime: '2026-01-05T03:00:00.000Z',
            attachments: [],
          },
        ],
      },
    ],
  },

  'projects.json': [
    {
      id: 'prj_smoke',
      name: 'โปรเจกต์ทดสอบ',
      description: 'ใช้ใน smoke test',
      pageIds: ['100000000000001'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],

  'page-config.json': {
    '100000000000001': {
      packageImage: '',
      startDate: '2026-01-01',
      character: 'โทนเป็นกันเอง',
      competitors: [{ name: 'คู่แข่ง ก', url: 'https://example.com/a' }],
      teams: {
        content: [{ empCode: 'E001', name: 'สมชาย ใจดี' }],
        graphic: [],
        chatInbox: [],
        am: [],
      },
    },
  },

  'saved-replies.json': {
    '100000000000001': [
      { id: 'sr_smoke', text: 'ขอบคุณที่ติดต่อมาครับ', tags: ['ทักทาย'], createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  },

  'tags.json': { t_smoke_1: ['VIP'] },
  'remarks.json': { t_smoke_1: 'ลูกค้าเก่า' },
  'statuses.json': { t_smoke_1: 'yellow' },
  'forwards.json': {
    t_smoke_1: [
      {
        id: 'fw_smoke',
        fromName: 'ผู้ทดสอบ',
        toNames: ['สมชาย ใจดี'],
        text: 'ฝากดูเคสนี้',
        createdTime: '2026-01-05T04:00:00.000Z',
      },
    ],
  },
  'settings.json': { syncIntervalMinutes: 1440 },
  'sync-history.json': [
    {
      id: 'run_smoke',
      trigger: 'manual',
      startedAt: '2026-01-02T00:00:00.000Z',
      finishedAt: '2026-01-02T00:00:05.000Z',
      results: [
        { pageId: '100000000000001', pageName: 'Smoke FB Page', ok: true, conversations: 1 },
      ],
    },
  ],
  'profile-pics.json': {},
  'competitors.json': [
    {
      id: 'cmp_smokebrand',
      url: 'https://www.facebook.com/smokebrand',
      handle: 'smokebrand',
      name: 'Smoke Brand',
      pictureUrl: '',
      addedAt: '2026-01-01T00:00:00.000Z',
      lastSyncAt: '2026-01-03T00:00:00.000Z',
      coveredFrom: '2026-01-01',
      coveredTo: '2026-01-03',
    },
  ],
  'competitor-posts.json': {
    cmp_smokebrand: [
      {
        id: 'p_smoke_1',
        competitorId: 'cmp_smokebrand',
        text: 'โพสต์ทดสอบคู่แข่ง',
        url: 'https://www.facebook.com/smokebrand/posts/1',
        time: '2026-01-02T05:00:00.000Z',
        likes: 10,
        comments: 2,
        shares: 1,
        imageUrl: 'https://scontent.xx.fbcdn.net/v/smoke.jpg',
        pageName: 'Smoke Brand',
      },
    ],
  },
  'competitor-sync.json': {
    cmp_smokebrand: [
      {
        id: 'crun_smoke',
        startedAt: '2026-01-03T00:00:00.000Z',
        finishedAt: '2026-01-03T00:00:10.000Z',
        range: 'current',
        rangeLabel: 'เดือนปัจจุบัน',
        requested: { from: '2026-01-01', to: '2026-01-03' },
        gaps: [{ from: '2026-01-01', to: '2026-01-03' }],
        fetched: 1,
        added: 1,
        skipped: false,
        ok: true,
      },
    ],
  },
};
