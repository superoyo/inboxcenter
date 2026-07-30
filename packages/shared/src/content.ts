/** โพสต์ของเพจเราเอง (ดึงผ่าน Graph API) */
export interface Post {
  id: string;
  message: string;
  createdTime: string;
  permalink: string;
  fullPicture?: string;
  reactions: number;
  comments: number;
  shares: number;
  /** reactions + comments + shares */
  engagementTotal: number;
}

/** สถิติเชิงลึกของโพสต์ — ต้องมีสิทธิ์ read_insights ไม่งั้น available = false */
export interface PostInsights {
  available: boolean;
  reason?: string;
  impressions?: number;
  reach?: number;
  organicReach?: number;
  paidReach?: number;
  clicks?: number;
}

export interface Comment {
  id: string;
  message: string;
  createdTime: string;
  fromId: string;
  fromName: string;
  fromPic?: string;
  likeCount?: number;
  replies?: Comment[];
}
