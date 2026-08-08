// Claude Code provider presets for the settings UI.
//
// Shipped in the repo, so every UI update (pulled from GitHub) refreshes these
// values. Each preset pre-fills the base URL + default models; the user only
// types their API key. Every field stays editable afterwards — and providers
// with several models offer a picker (models / haikuModels) to switch between
// them. Pick "Custom" to start from blank values.
//
// MODEL NAMES ARE THE EXACT STRINGS SENT TO THE PROVIDER'S ANTHROPIC API:
// defaults here are plain IDs (e.g. `deepseek-v4-pro`) that the endpoints
// accept verbatim. A `name[1m]` variant asks Claude Code for the 1M-context
// window — Claude Code normally strips the suffix before the request, but some
// versions send it literally, so `[1m]` options are offered for users who want
// 1M context, never used as the default.
//
// Before changing a preset, verify the Anthropic-compatible base URL and the
// current model names from the provider's docs.
//
// Referenced by _renderer.js via window.CLAUDE_PROVIDERS (loaded in ui.html
// before _renderer.js).
window.CLAUDE_PROVIDERS = [
    {
        id: "custom",
        label: "自定义",
        labelEn: "Custom",
        baseUrl: "",
        models: [],
        haikuModels: [],
        model: "",
        haikuModel: ""
    },
    {
        id: "anthropic",
        label: "Anthropic 官方",
        labelEn: "Anthropic Official",
        baseUrl: "https://api.anthropic.com",
        models: ["claude-sonnet-5", "claude-opus-5", "claude-fable-5", "claude-haiku-4-5-20251001"],
        haikuModels: ["claude-haiku-4-5-20251001"],
        model: "claude-sonnet-5",
        haikuModel: "claude-haiku-4-5-20251001"
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        labelEn: "DeepSeek",
        baseUrl: "https://api.deepseek.com/anthropic",
        models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-pro[1m]"],
        haikuModels: ["deepseek-v4-flash"],
        model: "deepseek-v4-pro",
        haikuModel: "deepseek-v4-flash"
    },
    {
        id: "zhipu",
        label: "智谱 GLM",
        labelEn: "Zhipu GLM",
        baseUrl: "https://open.bigmodel.cn/api/anthropic",
        models: ["glm-5.2", "glm-5.2[1m]"],
        haikuModels: ["glm-4.5-air"],
        model: "glm-5.2",
        haikuModel: "glm-4.5-air"
    },
    {
        id: "moonshot",
        label: "Kimi (Moonshot)",
        labelEn: "Kimi (Moonshot)",
        baseUrl: "https://api.moonshot.cn/anthropic",
        models: ["kimi-k2.5", "kimi-k2.6"],
        haikuModels: ["kimi-k2.5"],
        model: "kimi-k2.5",
        haikuModel: "kimi-k2.5"
    },
    {
        id: "qwen",
        label: "阿里云 Qwen",
        labelEn: "Alibaba Qwen",
        baseUrl: "https://coding.dashscope.aliyuncs.com/apps/anthropic",
        models: ["qwen3.7-plus", "qwen3.5-plus"],
        haikuModels: ["qwen3.5-plus"],
        model: "qwen3.7-plus",
        haikuModel: "qwen3.5-plus"
    },
    {
        id: "doubao",
        label: "字节豆包",
        labelEn: "Volcengine Doubao",
        baseUrl: "https://ark.cn-beijing.volces.com/api/coding",
        models: ["doubao-seed-2.0-code", "doubao-seed-2.0-pro"],
        haikuModels: ["doubao-seed-2.0-lite", "doubao-seed-code"],
        model: "doubao-seed-2.0-code",
        haikuModel: "doubao-seed-2.0-lite"
    },
    {
        id: "minimax",
        label: "MiniMax",
        labelEn: "MiniMax",
        baseUrl: "https://api.minimaxi.com/anthropic",
        models: ["MiniMax-M3", "MiniMax-M3[1m]"],
        haikuModels: ["MiniMax-M3"],
        model: "MiniMax-M3",
        haikuModel: "MiniMax-M3"
    }
];
