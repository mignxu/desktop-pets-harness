// 契约事件 zod schema(v1)——把 contracts.js 注释里的事件形状固化为可运行时校验的结构。
// 参考:笔记第 6 节"适配器翻译模式" + 第 7 节已锁定的契约词汇表。
// 用法:ThreadManager.handleEvent 收到 adapter 事件后调 validateContractEvent 校验(非致命,仅报错)。
'use strict';

const { z } = require("zod");

const threadId = z.string().min(1);

// turn.completed.outcome.usage —— 来自 harness result 消息,字段可能缺/为 null
const usageSchema = z
  .object({
    inputTokens: z.number().nullable().optional(),
    outputTokens: z.number().nullable().optional(),
    costUsd: z.number().nullable().optional(),
    error: z.string().optional(),
  })
  .optional();

const outcomeSchema = z.object({
  status: z.enum(["succeeded", "failed", "cancelled"]),
  result: z.string().optional(),
  usage: usageSchema,
  reason: z.string().optional(),
});

// item.started.item —— 不同 type 带的字段不同,统一用可选字段承载,避免误杀合法事件
const itemSchema = z.object({
  itemId: z.string().min(1),
  type: z.enum(["agentMessage", "reasoning", "commandExecution", "toolExecution", "fileChange"]),
  command: z.string().optional(),
  cwd: z.string().optional(),
  path: z.string().optional(),
  toolName: z.string().optional(),
  unifiedDiff: z.string().optional(),
  status: z.string().optional(),
  text: z.string().optional(),
  arguments: z.any().optional(),
});

const turnStartedSchema = z.object({ type: z.literal("turn.started"), threadId });

const turnCompletedSchema = z.object({
  type: z.literal("turn.completed"),
  threadId,
  outcome: outcomeSchema,
});

const turnFailedSchema = z.object({
  type: z.literal("turn.failed"),
  threadId,
  error: z.string(),
});

const itemStartedSchema = z.object({
  type: z.literal("item.started"),
  threadId,
  item: itemSchema,
});

const itemUpdatedSchema = z.object({
  type: z.literal("item.updated"),
  threadId,
  itemId: z.string().min(1),
  patch: z
    .object({
      textDelta: z.string().optional(),
      output: z.string().optional(),
      status: z.string().optional(),
    }),
});

const itemCompletedSchema = z.object({
  type: z.literal("item.completed"),
  threadId,
  itemId: z.string().min(1),
  status: z.string(),
});

const interactionOpenedSchema = z.object({
  type: z.literal("interaction.opened"),
  threadId,
  interaction: z.object({
    interactionId: z.string().min(1),
    kind: z.literal("approval"),
    toolName: z.string(),
    summary: z.string(),
    detail: z.any().optional(),
  }),
});

const interactionClosedSchema = z.object({
  type: z.literal("interaction.closed"),
  threadId,
  interactionId: z.string().min(1),
  resolution: z.enum(["allowed", "denied"]),
});

const threadMetaSchema = z.object({
  type: z.literal("thread.meta"),
  threadId,
  meta: z.object({
    model: z.string().optional(),
    cwd: z.string().optional(),
  }),
});

const ContractEventSchema = z.discriminatedUnion("type", [
  turnStartedSchema,
  turnCompletedSchema,
  turnFailedSchema,
  itemStartedSchema,
  itemUpdatedSchema,
  itemCompletedSchema,
  interactionOpenedSchema,
  interactionClosedSchema,
  threadMetaSchema,
]);

function validateContractEvent(event) {
  const result = ContractEventSchema.safeParse(event);
  if (result.success) return { ok: true, data: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

module.exports = { ContractEventSchema, validateContractEvent };
