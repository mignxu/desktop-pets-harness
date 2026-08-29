// file:// 直开时的配置快照（由 小呆/act_conf.json 与 pet_conf.json 生成于 2026-08-29）。
// 经 http 本地服务器访问时，Loader 会优先 fetch 实时文件，这份仅作兜底。
window.__FALLBACK__={
 "act_conf": {
  "default": {
   "images": "stand",
   "act_num": 5,
   "frame_refresh": 0.08
  },
  "up": {
   "images": "stand",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "down": {
   "images": "stand",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "left": {
   "images": "stand",
   "act_num": 5,
   "frame_refresh": 0.08
  },
  "right": {
   "images": "stand",
   "act_num": 5,
   "frame_refresh": 0.08
  },
  "sleep": {
   "images": "sleep",
   "act_num": 5,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "left_walk": {
   "images": "leftwalk",
   "act_num": 3,
   "need_move": true,
   "direction": "left",
   "frame_move": 3,
   "frame_refresh": 0.08
  },
  "right_walk": {
   "images": "rightwalk",
   "act_num": 3,
   "need_move": true,
   "direction": "right",
   "frame_move": 3,
   "frame_refresh": 0.08
  },
  "drag": {
   "images": "drag",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "edge": {
   "images": "edge",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "fall": {
   "images": "fall",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "onfloor": {
   "images": "onfloor",
   "act_num": 1,
   "frame_refresh": 0.02
  },
  "patpat1": {
   "images": "patpat",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "patpat2": {
   "images": "patpat2",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "sleepy": {
   "images": "sleepy",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "focus": {
   "images": "focus",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "feed_1": {
   "images": "feed",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "feed_2": {
   "images": "feed",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "feed_3": {
   "images": "feed",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  },
  "playball": {
   "images": "playball",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "hy1": {
   "images": "hy1",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "hy1end": {
   "images": "hy1end",
   "act_num": 1,
   "frame_refresh": 0.08
  },
  "disturbed": {
   "images": "disturbed",
   "act_num": 1,
   "frame_refresh": 0.08,
   "anchor": [
    0,
    18
   ]
  }
 },
 "pet_conf": {
  "width": 358,
  "height": 342,
  "scale": 0.8,
  "interact_speed": 0.02,
  "default": "default",
  "up": "up",
  "down": "down",
  "left": "left_walk",
  "right": "right_walk",
  "drag": "drag",
  "fall": "fall",
  "on_floor": "onfloor",
  "patpat": {
   "0": "sleep",
   "1": "patpat2",
   "2": "patpat1",
   "3": "patpat1"
  },
  "focus": "focus",
  "hide": "edge",
  "random_act": [
   {
    "name": "站立",
    "act_list": [
     "default"
    ],
    "act_prob": 1,
    "act_type": [
     2,
     0
    ]
   },
   {
    "name": "左右行走",
    "act_list": [
     "left_walk",
     "right_walk"
    ],
    "act_prob": 0.5,
    "act_type": [
     3,
     1
    ]
   },
   {
    "name": "打瞌睡",
    "act_list": [
     "sleepy"
    ],
    "act_prob": 0.5,
    "act_type": [
     1,
     0
    ]
   },
   {
    "name": "活跃动作",
    "act_list": [
     "hy1",
     "hy1",
     "hy1",
     "hy1end"
    ],
    "act_prob": 0.5,
    "act_type": [
     3,
     1
    ]
   },
   {
    "name": "玩球",
    "act_list": [
     "playball"
    ],
    "act_prob": 0.5,
    "act_type": [
     2,
     1
    ]
   },
   {
    "name": "被吵醒",
    "act_list": [
     "disturbed"
    ],
    "act_prob": 0.5,
    "act_type": [
     2,
     1
    ]
   },
   {
    "name": "睡觉",
    "act_list": [
     "sleep"
    ],
    "act_prob": 1,
    "act_type": [
     0,
     0
    ]
   },
   {
    "name": "feed_1",
    "act_list": [
     "feed_1"
    ],
    "act_prob": 0,
    "act_type": [
     0,
     10000
    ],
    "sound": [
     "feed_1"
    ]
   },
   {
    "name": "feed_2",
    "act_list": [
     "feed_2"
    ],
    "act_prob": 0,
    "act_type": [
     0,
     10000
    ],
    "sound": [
     "feed_2"
    ]
   },
   {
    "name": "feed_3",
    "act_list": [
     "feed_3"
    ],
    "act_prob": 0,
    "act_type": [
     0,
     10000
    ],
    "sound": [
     "feed_3"
    ]
   },
   {
    "name": "onfloor",
    "act_list": [
     "onfloor"
    ],
    "act_prob": 0,
    "act_type": [
     0,
     10000
    ]
   }
  ],
  "accessory_act": [],
  "item_favorite": {},
  "item_dislike": {},
  "prompt": "你是一只名叫小呆的可爱猫娘桌面宠物，性格活泼好奇、温柔亲人。你喜欢陪伴用户工作学习，偶尔会撒娇卖萌。你会关心用户的状态，在他们疲惫时给予安慰，开心时一起庆祝。你的回应简短友好，充满猫咪特有的俏皮感。"
 }
};
