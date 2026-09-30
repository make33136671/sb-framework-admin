/**
 * 洗稿细化选项定义（唯一清单）
 *
 * 这里只描述「有哪些选项、什么类型、范围多少、给用户看什么说明」；
 * 真正把选项翻译成提示词的逻辑在后端 RewriteOptions.BuildDirectives()
 * （见 api/Sb.Apps.DramaFlow.Services/Llm/RewriteOptions.cs）。
 * 两边字段名必须一致，options 以 JSON 传给 POST /Script/Rewrite 的 rewriteOptions。
 */

export interface NumericOption {
  key: string;
  label: string;
  type: 'number';
  min: number;
  max: number;
  step?: number;
  /** 单位/补充说明 */
  suffix?: string;
  desc: string;
}

export interface StrengthOption {
  key: string;
  label: string;
  type: 'strength';
  /** 1–5 级；0 = 关闭 */
  desc: string;
  /** 强化的具体内容（展开说明，让用户知道"强化了什么"） */
  detail: string;
}

export interface EnumOption {
  key: string;
  label: string;
  type: 'enum';
  options: { desc: string; label: string; value: string }[];
  desc: string;
}

export interface BoolOption {
  key: string;
  label: string;
  type: 'bool';
  desc: string;
}

export type RewriteOption =
  | BoolOption
  | EnumOption
  | NumericOption
  | StrengthOption;

export interface RewriteOptionGroup {
  /** 分组标识（A / B / B2 / C / D / E，与后端注释一致） */
  key: string;
  title: string;
  desc: string;
  options: RewriteOption[];
}

export const REWRITE_OPTION_GROUPS: RewriteOptionGroup[] = [
  {
    key: 'A',
    title: 'A 集级结构',
    desc: '决定切成多少集、每集多长、拆成几场',
    options: [
      {
        key: 'episodeCount',
        label: '总集数',
        type: 'number',
        min: 1,
        max: 200,
        suffix: '集',
        desc: '生成多少集（默认取剧目的目标集数）',
      },
      {
        key: 'episodeDuration',
        label: '每集时长',
        type: 'number',
        min: 5,
        max: 600,
        suffix: '秒',
        desc: '每集目标秒数',
      },
      {
        key: 'durationFlexPct',
        label: '时长浮动',
        type: 'number',
        min: 0,
        max: 60,
        suffix: '%',
        desc: '0 = 严格等长；填 20 表示允许 ±20%',
      },
      {
        key: 'scenesPerEpisode',
        label: '每集场次数',
        type: 'number',
        min: 1,
        max: 12,
        suffix: '场',
        desc: '拆分粒度：场次越多节奏越碎',
      },
      {
        key: 'shotsPerEpisode',
        label: '每集镜头数',
        type: 'number',
        min: 1,
        max: 40,
        suffix: '镜',
        desc: '为后续分镜环节预留的节奏基准',
      },
    ],
  },
  {
    key: 'B',
    title: 'B 集内结构与强化分析',
    desc: '每一项可单独强化（0=关，1–5 级），这是你重点要的部分',
    options: [
      {
        key: 'strengthenHook',
        label: '开头钩子强化',
        type: 'strength',
        desc: '前 3 秒强钩子',
        detail: '要求句式轮换不得重复，且钩子必须与主线冲突直接相关',
      },
      {
        key: 'strengthenCliffhanger',
        label: '集末悬念强化',
        type: 'strength',
        desc: '每集结尾留悬念',
        detail: '连续两集不得用同类型悬念（身份/危机/误会/反转轮换）',
      },
      {
        key: 'strengthenPacing',
        label: '节奏分析强化',
        type: 'strength',
        desc: '逐场标注作用与情绪强度',
        detail:
          '标注每场是推进主线/制造反转/铺垫伏笔 + 情绪强度 1-5，无作用的场次压缩或删除',
      },
      {
        key: 'strengthenDurationAlloc',
        label: '时长分配分析',
        type: 'strength',
        desc: '先分配秒数再写内容',
        detail: '钩子场 ≤8 秒、反转场 6–10 秒、铺垫场 ≤5 秒，禁止前松后紧',
      },
      {
        key: 'payoffDensity',
        label: '爽点 / 反转密度',
        type: 'strength',
        desc: '每集爽点数量',
        detail: '每集至少 N 个爽点/反转，且每 3 集必须有一次主线级大反转',
      },
    ],
  },
  {
    key: 'B2',
    title: 'B2 AI 剧本润色',
    desc: '原稿只写了概要/大纲时，把它润色成可直接拍摄的完整剧本（强度与深度独立可调）',
    options: [
      {
        key: 'polishStrength',
        label: '润色强度',
        type: 'strength',
        desc: '补全的主动程度（0=关）',
        detail:
          '越大越主动：把「两人吵架后分手」这类一句话情节补成完整场景与对白；4 级以上允许补足细节与情绪层次',
      },
      {
        key: 'polishDepth',
        label: '润色深度',
        type: 'strength',
        desc: '改写彻底程度（0=关）',
        detail:
          '1=只补对白；2=补对白+动作；3=重写场景内部；4=可调场景顺序与节奏；5=按短剧标准彻底重写该段',
      },
      {
        key: 'polishStyle',
        label: '润色风格',
        type: 'enum',
        desc: '展开成什么样',
        options: [
          {
            label: '保留原意',
            value: 'preserve',
            desc: '不新增情节，只把概要展开成可拍场景与对白',
          },
          {
            label: '小说化',
            value: 'novel',
            desc: '允许心理与环境描写（仍需转成可拍画面）',
          },
          {
            label: '标准剧本',
            value: 'screenplay',
            desc: '场景标题 + 动作描述 + 角色名:对白',
          },
        ],
      },
    ],
  },
  {
    key: 'C',
    title: 'C 内容策略',
    desc: '改多少、怎么改、怎么说话',
    options: [
      {
        key: 'fidelity',
        label: '忠实度',
        type: 'enum',
        desc: '对原著的改动幅度',
        options: [
          {
            label: '忠于原著',
            value: 'faithful',
            desc: '保留主线与事件顺序，只做短剧化裁剪',
          },
          {
            label: '平衡',
            value: 'balanced',
            desc: '保留主线，允许调整事件顺序、合并次要人物',
          },
          {
            label: '大胆改编',
            value: 'bold',
            desc: '可重排事件、增删次要冲突，主角与核心矛盾不变',
          },
        ],
      },
      {
        key: 'adaptationScale',
        label: '改编尺度',
        type: 'enum',
        desc: '冲突与张力的强度',
        options: [
          { label: '保守', value: 'conservative', desc: '不新增设定与人物' },
          { label: '中等', value: 'medium', desc: '适度强化冲突与情感张力' },
          {
            label: '激进',
            value: 'aggressive',
            desc: '强化对立面与压迫感（不新增世界观）',
          },
        ],
      },
      {
        key: 'dialogueStyle',
        label: '对白口语化',
        type: 'enum',
        desc: '台词风格与字数上限',
        options: [
          { label: '轻改', value: 'light', desc: '保留原措辞，仅去书面语' },
          { label: '中', value: 'medium', desc: '口语化，每句 ≤15 字' },
          {
            label: '强',
            value: 'strong',
            desc: '日常口语，每句 ≤12 字，可用短促打断句',
          },
        ],
      },
      {
        key: 'narration',
        label: '旁白比例',
        type: 'enum',
        desc: '旁白用量',
        options: [
          { label: '无旁白', value: 'none', desc: '全靠对白与动作交代' },
          {
            label: '少量',
            value: 'light',
            desc: '仅场景快速切换时用（每集 ≤1 处）',
          },
          {
            label: '较多',
            value: 'more',
            desc: '可交代时间跳跃与内心（每集 ≤3 处）',
          },
        ],
      },
    ],
  },
  {
    key: 'D',
    title: 'D 人物与主线',
    desc: '人物小传、弧线、一致性与关系网',
    options: [
      {
        key: 'characterBio',
        label: '生成人物小传',
        type: 'bool',
        desc: '为主要角色写性格/动机/说话风格，并在对白中贯彻',
      },
      {
        key: 'characterArc',
        label: '人物弧线分析',
        type: 'bool',
        desc: '主角成长线与反派升级线分集规划，每集必须推进一步',
      },
      {
        key: 'characterConsistency',
        label: '人物一致性约束',
        type: 'bool',
        desc: '唯一规范名 + 固定称谓，禁止称呼漂移（建议保持开启）',
      },
      {
        key: 'relationMap',
        label: '提取人物关系网',
        type: 'bool',
        desc: '额外输出 relations（敌对/盟友/亲属/暧昧 + 变化集号），供素材与分镜复用',
      },
    ],
  },
  {
    key: 'E',
    title: 'E 各动作强化',
    desc: '洗稿之外的环节：分镜 / 素材提取 / 出图提示词 / 片段 / 成片（随剧本一起记住）',
    options: [
      {
        key: 'shotsDensity',
        label: '分镜密度',
        type: 'strength',
        desc: '全剧镜头密度基准',
        detail: '按每集 N 镜规划，供分镜环节沿用',
      },
      {
        key: 'shotDurationSpread',
        label: '单镜时长分布',
        type: 'bool',
        desc: '3/5/8 秒三档规律分布，避免全剧同长',
      },
      {
        key: 'shotCompositionVariety',
        label: '景别多样性',
        type: 'bool',
        desc: '同场景景别必须变化，不得连续三镜同景别',
      },
      {
        key: 'shotLightingMood',
        label: '光影情绪标注',
        type: 'bool',
        desc: '每场标注光影与情绪基调，供分镜与出图沿用',
      },
      {
        key: 'shotSceneContinuity',
        label: '场景连续性',
        type: 'bool',
        desc: '同场景跨集环境细节保持一致',
      },
      {
        key: 'assetCrossEpisodeConsistency',
        label: '素材跨集一致性',
        type: 'bool',
        desc: '同一角色/场景跨集外貌描述一致，冲突以首次出现为准',
      },
      {
        key: 'assetCostumeDetail',
        label: '服装道具细节',
        type: 'bool',
        desc: '提取素材时补充服装与随身道具，便于出图统一',
      },
      {
        key: 'promptStrongCanon',
        label: '角色规范注入',
        type: 'bool',
        desc: '出图提示词原样包含角色规范，不改写不省略（建议开启）',
      },
      {
        key: 'promptNegativeStrong',
        label: '负面词强化',
        type: 'bool',
        desc: '追加负面词：多余手指、畸变、低清、水印、文字、多人重复',
      },
      {
        key: 'promptCompositionTemplate',
        label: '构图模板化',
        type: 'bool',
        desc: '按「主体+动作+景别+光线+风格」固定顺序组织提示词',
      },
      {
        key: 'clipMotionAmplitude',
        label: 'i2v 运动幅度',
        type: 'bool',
        desc: '运动幅度适中，避免人物变形与背景漂移',
      },
      {
        key: 'clipFirstFrameConsistency',
        label: 'i2v 首帧一致性',
        type: 'bool',
        desc: '首帧与已选素材图一致，不改变人物外观',
      },
      {
        key: 'productEpisodeTransition',
        label: '集间衔接',
        type: 'bool',
        desc: '成片合并保留集末悬念画面，集间不加重叠转场',
      },
    ],
  },
];

/** 面板默认值（与后端 RewriteOptions 的默认值保持一致） */
export function defaultRewriteOptions(): Record<string, any> {
  return {
    // A
    episodeCount: 10,
    episodeDuration: 30,
    durationFlexPct: 0,
    scenesPerEpisode: 3,
    shotsPerEpisode: 10,
    // B
    strengthenHook: 0,
    strengthenCliffhanger: 0,
    strengthenPacing: 0,
    strengthenDurationAlloc: 0,
    payoffDensity: 0,
    // B2 润色
    polishStrength: 0,
    polishDepth: 0,
    polishStyle: 'preserve',
    // C
    fidelity: 'balanced',
    adaptationScale: 'medium',
    dialogueStyle: 'medium',
    narration: 'light',
    // D
    characterBio: false,
    characterArc: false,
    characterConsistency: true,
    relationMap: false,
    // E
    shotsDensity: 0,
    shotDurationSpread: false,
    shotCompositionVariety: false,
    shotLightingMood: false,
    shotSceneContinuity: false,
    assetCrossEpisodeConsistency: false,
    assetCostumeDetail: false,
    promptStrongCanon: true,
    promptNegativeStrong: false,
    promptCompositionTemplate: false,
    clipMotionAmplitude: false,
    clipFirstFrameConsistency: false,
    productEpisodeTransition: false,
  };
}

/** 强选项预设：常用组合，一键套用 */
export const REWRITE_PRESETS: {
  desc: string;
  name: string;
  patch: Record<string, any>;
}[] = [
  {
    name: '快速出片（默认）',
    desc: '均衡，不开强化，最快看到结果',
    patch: { ...defaultRewriteOptions() },
  },
  {
    name: '节奏优先',
    desc: '钩子/悬念/节奏/时长分配全开 + 强口语化',
    patch: {
      strengthenHook: 3,
      strengthenCliffhanger: 3,
      strengthenPacing: 3,
      strengthenDurationAlloc: 3,
      payoffDensity: 2,
      dialogueStyle: 'strong',
      narration: 'none',
    },
  },
  {
    name: '人物优先',
    desc: '人物小传 + 弧线 + 一致性 + 关系网',
    patch: {
      characterBio: true,
      characterArc: true,
      characterConsistency: true,
      relationMap: true,
      strengthenPacing: 2,
    },
  },
  {
    name: '概要润色',
    desc: '原稿只有概要：强度 4 + 深度 3，展开成可拍剧本',
    patch: {
      polishStrength: 4,
      polishDepth: 3,
      polishStyle: 'preserve',
    },
  },
  {
    name: '忠于原著',
    desc: '不改剧情，只做短剧化裁剪',
    patch: {
      fidelity: 'faithful',
      adaptationScale: 'conservative',
      dialogueStyle: 'light',
      narration: 'light',
    },
  },
  {
    name: '爽剧模式',
    desc: '大胆改编 + 高爽点密度 + 激进尺度',
    patch: {
      fidelity: 'bold',
      adaptationScale: 'aggressive',
      payoffDensity: 4,
      strengthenHook: 4,
      strengthenCliffhanger: 4,
      dialogueStyle: 'strong',
    },
  },
];
