// ══ GENERATED FILE — DO NOT EDIT ══
// 本文件由 sync-client-host-adapter.mjs 生成 —— 手工修改会在下一次同步时被覆盖，
// 且本包的自检（--verify / 单测）会判红（客户端面常量 ≠ 唯一源）。
// source: lib/host-adapter.mjs
// sourceSha256: a68d0ea30bdf6e0376c886d4ee8953ee226b22ea3d50c7b6ec55eb99f14fd88a
// sourceVersion: 0.3.1
// format: client-modules-cjs
// target: @kira905/dsh-host-adapter-client
// ══ END HEADER ══
/**
 * 客户端适配层（浏览器半）：ctx 服务名 / 事件名的**唯一来源**（派生自 lib/host-adapter.mjs）。
 *
 * 消费方式（各客户端 bundle 内）：
 *   const A = require('@kira905/dsh-host-adapter-client');   // 或 require('@kira905/dsh-host-adapter-client/client')
 *   const inject = [A.SVC.slots, A.SVC.locale];
 *   ctx.on(A.EV.CONNECTION_RESET, handler);
 * ⚠️ 消费方的 package.json 必须在 `dsh.client.external` 里声明本包 —— 宿主按它排序 boot graph
 *    （依赖 row 先于消费方 register），否则同步 require 会 MISS 模块表。
 */
window.__ModuleLoader__.load({
	id: "@kira905/dsh-host-adapter-client",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		/** ctx 服务名（值 == 键名，冻结；与服务端唯一源逐条同源）。 */
		const SVC = Object.freeze({
			webServer: "webServer",
			settings: "settings",
			settingsScope: "settingsScope",
			commands: "commands",
			tools: "tools",
			skills: "skills",
			sessionTitle: "sessionTitle",
			llm: "llm",
			sessions: "sessions",
			systemPrompt: "systemPrompt",
			apiProxy: "apiProxy",
			agents: "agents",
			logger: "logger",
			locale: "locale",
			slots: "slots",
			connection: "connection",
			remote: "remote",
			workspaces: "workspaces",
			sessionController: "sessionController",
			settingsController: "settingsController",
			workspaceController: "workspaceController",
			sessionFeedback: "sessionFeedback",
			workspaceFiles: "workspaceFiles",
			documentPreviews: "documentPreviews",
			fileUpload: "fileUpload",
			resources: "resources",
			webhookRuntime: "webhookRuntime",
			clientModules: "clientModules",
		});

		/** 主包事件名（与服务端唯一源逐条同源）。 */
		const EV = Object.freeze({
			TURN_START: "turn/start",
			TURN_END: "turn/end",
			SESSION_END_SEED: "session/end-seed",
			SESSION_TITLE: "session/title",
			LEGACY_ASSISTANT_CHUNK: "assistant/chunk",
			ASSISTANT_ATTEMPT: "assistant/attempt",
			ASSISTANT_MESSAGE: "assistant/message",
			LEGACY_TOOL_CODE_DISPATCH: "tool/code-dispatch",
			LEGACY_TOOL_CODE_DISPATCH_START: "tool/code-dispatch-start",
			TOOL_PTC_DISPATCH: "tool/ptc-dispatch",
			TOOL_PTC_DISPATCH_START: "tool/ptc-dispatch-start",
			TOOL_CALL: "tool/call",
			TOOL_RESULT: "tool/result",
			USER_MESSAGE: "user/message",
			SESSION_EVENT: "session/event",
			SESSION_TITLE_LLM_REQUEST: "session/title-llm-request",
			CONNECTION_RESET: "connection/reset",
			STEP_START: "step/start",
			REQUEST_HEADER: "request/header",
			REQUEST_CONTEXT: "request/context",
			PERMISSION_PRESET: "permission/preset",
			SANDBOX_MODE: "sandbox/mode",
			APPROVAL_POLICY: "approval/policy",
			FS_WRITE_INTENT: "fs/write-intent",
			FS_EDIT_INTENT: "fs/edit-intent",
			FS_OBSERVED: "fs/observed",
			TOOLS_PRE_EXECUTE: "tools/pre-execute",
			DELIVERABLES_PRESENTED: "deliverables/presented",
			FEEDBACK_MESSAGE_PUT: "feedback/message-put",
			FEEDBACK_MESSAGE_DELETE: "feedback/message-delete",
			MODEL_SELECTION: "model/selection",
			SESSION_LOG_DELIVERY_ACCEPTED: "session-log-deepseek/delivery-accepted",
			SUBAGENT_CATALOG: "subagent/catalog",
			SUBAGENT_MODEL_SELECTION_POLICY: "subagent/model-selection-policy",
			SYSTEM_MESSAGE: "system/message",
		});

		exports.SVC = SVC;
		exports.EV = EV;
		exports.HOST_ADAPTER_VERSION = "0.3.1";

		// ── 客户端 cordis 插件契约（必需）──────────────────────────────────────
		// 宿主把每个 client bundle 当**插件 entry** 加载（cordis Loader → internal.import）：
		// 缺 apply 会报 invalid plugin（expect function or object with an "apply" method），
		// 整条 entry apply 失败 —— 2026-09-25 在 3090 实测踩到，故补契约三件套。
		// 本包是**纯常量模块**：apply 有意为空，inject 为空（不依赖任何客户端服务）。
		exports.name = "@kira905/dsh-host-adapter-client";
		exports.inject = [];
		exports.apply = function apply() {};
		return module.exports;
	}
});
