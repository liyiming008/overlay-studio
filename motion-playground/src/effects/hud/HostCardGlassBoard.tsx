import { Fragment, useContext, useState, type CSSProperties } from "react";
import type { EffectDef, EffectProps } from "../types";
import { FxSpeedContext } from "../useAnimation";
import { useCardElapsed } from "./useTimelineTime";
import { FxVideo, isVideoSrc } from "./MediaImg";
import { fcBez } from "./camGeom";
import { ACCENT_SWATCH, OFFSET_CONTROLS, OFFSET_DEFAULTS, THEME_OPTIONS } from "./accent";
import { STAGE } from "../../stage";
import "./host-card-glass-board.css";

export interface HostBoardStep { icon: string; label: string; sub: string }
export interface HostCardGlassBoardParams {
  theme: "dark" | "light";
  hostSrc: string;
  /** 兼容全局口播注入；hostSrc 优先。素材按整条时间轴对位。 */
  camSrc?: string;
  tag: string;
  title: string;
  en: string;
  steps: string | HostBoardStep[];
  tileAt: string | number[];
  result: string;
  resultAt: number;
  accent: string;
  /** 人物素材存在时始终铺底；false 只在无素材时保留透明。 */
  studio: boolean;
  offsetX?: number;
  offsetY?: number;
}

/** 画布与卡片共用背景判定，兼容旧的 studio:false 和全局口播。 */
export function hostBoardHasBackdrop(params: { hostSrc?: unknown; camSrc?: unknown; studio?: unknown }, cam?: string | null) {
  return !!(params.hostSrc || params.camSrc || cam) || params.studio !== false;
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const out = (x: number) => 1 - (1 - x) ** 3;
const out4 = (x: number) => 1 - (1 - x) ** 4;
const back = (x: number) => 1 + 2.6 * (x - 1) ** 3 + 1.6 * (x - 1) ** 2;
const tween = (t: number, start: number, duration: number, ease = out) => ease(clamp((t - start) / duration));
const cameraIn = fcBez(0.55, 0, 0.12, 1);
const cameraOut = fcBez(0.6, 0, 0.25, 1);
const str = (x: unknown) => typeof x === "string" ? x : "";

/** 编辑器用逐行文本，原始迁移接口仍接受对象数组或 JSON 文本。 */
export function hostBoardSteps(value: unknown): HostBoardStep[] {
  let rows: unknown = value;
  if (typeof value === "string") {
    if (value.trim().startsWith("[")) {
      try { rows = JSON.parse(value); } catch { rows = []; }
    } else {
      rows = value.split("\n").filter((s) => s.trim()).map((s) => {
        const [icon = "", label = "", sub = ""] = s.split("|");
        return { icon: icon.trim(), label: label.trim(), sub: sub.trim() };
      });
    }
  }
  const steps = (Array.isArray(rows) ? rows : []).filter((s) => s && typeof s === "object")
    .slice(0, 4).map((s, i) => ({ icon: str(s.icon) || String(i + 1), label: str(s.label), sub: str(s.sub) }));
  // 编辑中空内容也保持两个槽位，不出现 NaN 或越界。
  while (steps.length < 2) steps.push({ icon: String(steps.length + 1), label: "步骤", sub: "" });
  return steps;
}

/** 词锚是相对卡片 start 的秒数；两端落定后才连线，结果等待整条链完成。 */
export function hostBoardTiming(value: unknown, count: number, resultAt: number, duration = 6.6, speed = 1) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,，\s]+/).filter(Boolean);
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const n = Number(raw[i]);
    times.push(Math.max(i ? times[i - 1] + 0.5 / speed : 0, Number.isFinite(n) && n >= 0 ? n : 1.6 + i * 0.9));
  }
  const connectors = times.slice(1).map((t, i) => Math.max(t, times[i]) + 0.5 / speed);
  const result = Math.max(Number.isFinite(resultAt) ? resultAt : 4.1, times[count - 1] + 0.5 / speed,
    ...connectors.map((t) => t + 0.4 / speed));
  // 过短的卡整体压缩编排，避免最后一步/结果还没出现就卸载。
  // 给板面撤离、人物展开留出完整的一拍；短卡和倍速同步缩放。
  const exitDuration = Math.min(1.05 / speed, duration * 0.3);
  const exitAt = duration - exitDuration;
  const fit = Math.min(1, Math.max(0.01, exitAt / (result + 0.45 / speed + 0.3)));
  return { tiles: times.map((t) => t * fit), connectors: connectors.map((t) => t * fit), result: result * fit, fit, exitAt, exitDuration };
}

/** 960×540 原作单位；横屏 1080p 恰好 ×2。竖画布上方 40% 人物、下方 60% 平板。 */
export function hostBoardLayout(width: number, height: number) {
  if (height > width) {
    const hostScale = Math.min(width * 0.8 / 250, height * 0.36 / 444);
    const boardScale = Math.min(width * 0.9 / 570, height * 0.5 / 408);
    return { portrait: true, host: { x: (width - 250 * hostScale) / 2, y: height * 0.02, scale: hostScale },
      board: { x: (width - 570 * boardScale) / 2, y: height * 0.43, scale: boardScale } };
  }
  const scale = Math.min(width / 960, height / 540);
  const x = (width - 960 * scale) / 2, y = (height - 540 * scale) / 2;
  return { portrait: false, host: { x: x + 64 * scale, y: y + 48 * scale, scale },
    board: { x: x + 340 * scale, y: y + 58 * scale, scale } };
}

function textSize(text: string, max: number, width: number, tracking = 0) {
  const units = [...text].reduce((sum, ch) => sum + (ch.codePointAt(0)! <= 255 ? 0.56 : 1), 0);
  return Math.max(10, Math.min(max, (width - [...text].length * tracking) / Math.max(1, units)));
}

function HostCardGlassBoard({ params, playToken }: EffectProps<HostCardGlassBoardParams>) {
  const p = params as HostCardGlassBoardParams & { __t?: number; __start?: number; __end?: number; __playing?: boolean };
  const [readySrc, setReadySrc] = useState("");
  const t = useCardElapsed(p, playToken);
  const speedValue = useContext(FxSpeedContext);
  const speed = speedValue > 0 && Number.isFinite(speedValue) ? speedValue : 1;
  const duration = typeof p.__end === "number" ? Math.max(0.01, p.__end - (p.__start ?? 0)) : 6.6;
  const steps = hostBoardSteps(p.steps);
  const timing = hostBoardTiming(p.tileAt, steps.length, Number(p.resultAt), duration, speed);
  const localT = t / timing.fit;
  const motionT = localT * speed;
  const exitP = tween(t, timing.exitAt, timing.exitDuration * 0.65, (v) => v ** 3);
  const exit = 1 - exitP;
  const cameraP = tween(motionT, 0.05, 1, cameraIn)
    * (1 - tween(t, timing.exitAt + timing.exitDuration * 0.18, timing.exitDuration * 0.7, cameraOut));
  const boardP = tween(motionT, 0.35, 0.75, out4);
  const hostP = tween(motionT, 0.3, 0.5, out4);
  const tagP = tween(motionT, 0.9, 0.4);
  const enP = tween(motionT, 1.45, 0.4);
  const resultP = tween(t, timing.result, 0.45 * timing.fit / speed, out4);
  const sheen = tween(motionT, 0.6, 0.9, (x) => x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const layout = hostBoardLayout(STAGE.w, STAGE.h);
  const gap = steps.length === 4 ? 26 : 41;
  const tileW = Math.min(140, (514 - (steps.length - 1) * gap) / steps.length);
  const tilesW = steps.length * tileW + (steps.length - 1) * gap;
  const accent = /^#[0-9a-f]{6}$/i.test(p.accent) ? p.accent : ACCENT_SWATCH[p.accent] ?? "#8ab4ff";
  const title = str(p.title), tag = str(p.tag), en = str(p.en), result = str(p.result);
  const src = p.hostSrc || p.camSrc;
  const exporting = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("export") === "1";
  const mediaReady = exporting || !src || !isVideoSrc(src) || readySrc === src;
  const active = p.__t === undefined || p.__t >= (p.__start ?? 0);
  // 兼容旧卡保存的 studio:false：带人物的场景必须盖住底层原片，避免双人叠影。
  const studio = hostBoardHasBackdrop(p);
  // 全屏端点还原原片取景，缩入后再过渡到竖卡裁切。人物独立于板面缩放层，
  // 因此卡片大小/位移不会让全屏端点露边；预览与导出都由本卡绘制同一条曲线。
  const hostK = src ? cameraP : 1;
  const hostScale = layout.host.scale;
  const mediaStyle: CSSProperties = { position: "absolute", left: 0, bottom: `${-6 * hostK}%`, width: "100%", height: `${100 + 6 * hostK}%`, objectFit: "cover", objectPosition: `50% ${50 - 5 * hostK}%` };
  return (
    <div className="hud hcg" data-hcg-theme={p.theme} data-host-ready={mediaReady ? "1" : "0"} data-host-active={active ? "1" : "0"} style={{
      "--hcg-accent": accent,
      // 如 FocusCard 一样由卡本体接管场景；通用退场不能让背景透出第二个人物。
      opacity: 1,
      visibility: active && mediaReady ? "visible" : "hidden",
    } as CSSProperties}>
      {studio && <div className="hcg-studio" />}
      <div className="hcg-content" style={{
        transform: `translate(${p.offsetX ?? 0}px, ${p.offsetY ?? 0}px) scale(var(--hud-scale, 1))`,
        opacity: exit,
      }}>
        <div className="hcg-perspective" style={{ perspective: 1400 * layout.board.scale }}>
          <div className="hcg-board" style={{ left: layout.board.x, top: layout.board.y, opacity: boardP,
            transform: `translate(${(56 * (1 - boardP) + 36 * exitP) * layout.board.scale}px, ${(24 * (1 - boardP) - 16 * exitP) * layout.board.scale}px) scale(${layout.board.scale * (0.94 + 0.06 * boardP - 0.04 * exitP)}) rotateY(${layout.portrait ? 0 : -24 + 14 * boardP - 8 * exitP}deg)` }}>
            <div className="hcg-sheen" style={{ opacity: motionT >= 0.6 && motionT < 1.5 ? 1 : 0,
              transform: `translateX(${900 * sheen}px) skewX(-18deg)` }} />
            <div className="hcg-tag" style={{ opacity: tagP, fontSize: textSize(tag, 13, 510, 2), transform: `translateY(${6 * (1 - tagP)}px)` }}>{tag}</div>
            <div className="hcg-title" style={{ fontSize: textSize(title, 46, 510, 2) }}>
              {[...title].map((ch, i, chars) => {
                const stagger = Math.min(0.06, 0.5 / Math.max(1, chars.length - 1));
                const q = tween(motionT, 1 + i * stagger, 0.45);
                return <span key={i} style={{ opacity: q, filter: `blur(${8 * (1 - q)}px)`, transform: `translateY(${8 * (1 - q)}px)` }}>{ch === " " ? "\u00a0" : ch}</span>;
              })}
            </div>
            <div className="hcg-en" style={{ opacity: enP, fontSize: textSize(en, 12, 510, 2), transform: `translateY(${6 * (1 - enP)}px)` }}>{en}</div>
            <div className="hcg-tiles" style={{ left: (570 - tilesW) / 2, width: tilesW }}>
              {steps.map((step, i) => {
                const q = tween(t, timing.tiles[i], 0.5 * timing.fit / speed, back);
                const line = i < steps.length - 1 ? tween(t, timing.connectors[i], 0.35 * timing.fit / speed) : 0;
                const arrow = i < steps.length - 1 ? tween(t, timing.connectors[i] + 0.25 * timing.fit / speed, 0.15 * timing.fit / speed) : 0;
                return <Fragment key={i}>
                  <div className="hcg-tile" style={{ left: i * (tileW + gap), width: tileW, opacity: clamp(q), transform: `scale(${0.8 + 0.2 * q})` }}>
                    <div className="hcg-icon">{/^(\/|https?:|data:image\/)/.test(step.icon) ? <img src={step.icon} alt="" /> : step.icon}</div>
                    <div className="hcg-label" style={{ fontSize: textSize(step.label, 20, tileW - 16) }}>{step.label}</div>
                    <div className="hcg-sub" style={{ fontSize: textSize(step.sub, 9, tileW - 12) }}>{step.sub}</div>
                  </div>
                  {i < steps.length - 1 && <div className="hcg-connector" style={{ left: i * (tileW + gap) + tileW, width: gap }}>
                    <i style={{ transform: `scaleX(${line})` }} /><b style={{ opacity: arrow }} />
                  </div>}
                </Fragment>;
              })}
            </div>
            {result && <div className="hcg-result" style={{ opacity: resultP, fontSize: textSize(result, 17, 470),
              transform: `translateX(-50%) translateY(${8 * (1 - resultP)}px)` }}>{result}</div>}
          </div>
        </div>
      </div>
      {/* 人物在板面之上：入场先从全屏缩入，退场板面先收再回满屏。 */}
      <div className="hcg-host-motion" style={{
        transform: `translate(${(p.offsetX ?? 0) * hostK}px, ${(p.offsetY ?? 0) * hostK}px) scale(calc(1 + (var(--hud-scale, 1) - 1) * ${hostK}))`,
      }}>
        <div className="hcg-host" data-crop-ok style={{
          left: layout.host.x * hostK, top: layout.host.y * hostK,
          width: STAGE.w + (250 * hostScale - STAGE.w) * hostK,
          height: STAGE.h + (444 * hostScale - STAGE.h) * hostK,
          borderRadius: 22 * hostScale * hostK, borderWidth: (p.theme === "light" ? 1 : 2) * hostScale * hostK,
          boxShadow: p.theme === "light" ? "none" : `0 ${20 * hostScale}px ${60 * hostScale}px rgba(0,0,0,${0.3 * hostK})`,
          opacity: src ? 1 : hostP * exit,
          transform: src ? undefined : `translateX(${(-40 * (1 - hostP) - 28 * exitP) * hostScale}px)`,
        }}>
          {src ? isVideoSrc(src)
            ? <FxVideo src={src} tStart={0} time={p.__t ?? t} playing={p.__playing ?? true} onReady={(ready) => setReadySrc(ready ? src : "")} style={mediaStyle} />
            : <img src={src} alt="口播人物" style={mediaStyle} />
            : <div className="hcg-silhouette" />}
        </div>
      </div>
    </div>
  );
}

export const hostCardGlassBoardDef: EffectDef<HostCardGlassBoardParams> = {
  id: "host-card-glass-board",
  name: "HostCardGlassBoard",
  description: "人物常驻竖卡 + 3D 玻璃板，步骤按词锚接力落位；独占场景，字幕避开人物卡",
  tags: ["取景重构", "3D 浮屏", "逐条落位", "玻璃虚化"],
  selfPosition: true,
  defaults: {
    theme: "dark",
    hostSrc: "",
    tag: "WORKFLOW · 工作流",
    title: "口播工作流",
    en: "SCRIPT → VOICE → RENDER",
    steps: "✎|文稿|SCRIPT\n◉|配音|VOICE\n▶|成片|RENDER",
    tileAt: "1.6, 2.5, 3.4",
    result: "从想法到成片",
    resultAt: 4.1,
    accent: "#8ab4ff",
    studio: true,
    ...OFFSET_DEFAULTS,
  },
  controls: [
    { key: "theme", label: "材质主题", type: "select", options: THEME_OPTIONS },
    { key: "hostSrc", label: "人物素材（留空用全局口播）", type: "text" },
    { key: "tag", label: "板头小字", type: "text" },
    { key: "title", label: "主标题", type: "text" },
    { key: "en", label: "英文副标题", type: "text" },
    { key: "steps", label: "步骤（2–4 步，每行一步）", type: "textarea", rows: 4,
      help: "图标字符或图片路径|名称|副标\n✎|文稿|SCRIPT\n也接受原始 [{icon, label, sub}] JSON 数组。" },
    { key: "tileAt", label: "每步词锚（相对卡片起点秒数，逗号分隔）", type: "text" },
    { key: "result", label: "结果胶囊", type: "text" },
    { key: "resultAt", label: "结果入场（会等连线完成）", type: "range", min: 0, max: 60, step: 0.1, unit: "s" },
    { key: "accent", label: "强调色", type: "color" },
    { key: "studio", label: "演播室底色（有人物时自动开启）", type: "toggle" },
    ...OFFSET_CONTROLS,
  ],
  Component: HostCardGlassBoard,
};
