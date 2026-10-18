import { useEffect, useRef, type CSSProperties } from "react";
import { imgRetry } from "./imgRetry";

/** 导出模式下视频不自动播,由导出脚本逐帧 seek */
const IS_EXPORT =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("export") === "1";

export const isVideoSrc = (src: string) => /\.(mp4|mov|webm|m4v)(\?|$)/i.test(src);

/**
 * 卡内视频通用槽:预览用 <video> 静音循环自动播;
 * 导出用 <img> 逐帧换预抽好的帧图(虚拟时钟下 Chrome 媒体管线完全冻结,
 * <video> 永远解不出画面——导出脚本先用 ffmpeg 把视频抽成 JPEG 序列,
 * __seekVideos 按时间轴换 img.src,图片加载不受虚拟时钟影响)。
 * loop = 短素材循环:导出按素材时长取模对位(data-fx-loop)。
 */
export function FxVideo({
  src,
  className,
  tStart,
  clipStart,
  loop,
  rate,
  time,
  playing,
  onReady,
  style,
}: {
  src: string;
  className?: string;
  tStart?: number;
  /** 从素材的第几秒开始播(同一条视频切出不同片段时用) */
  clipStart?: number;
  loop?: boolean;
  /** 播放倍速:1.5 / 2 …(长录屏塞进短窗口用);导出侧按倍速换算帧号 */
  rate?: number;
  /** 可选的权威素材时钟：暂停时停帧，拖动和新挂载都按同一时间定位。 */
  time?: number;
  /** 权威时钟的播放状态：播放时原生解码，只在漂移时校正。 */
  playing?: boolean;
  onReady?: (ready: boolean) => void;
  style?: CSSProperties;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const clip = clipStart && clipStart > 0 ? clipStart : 0;
  const spd = rate && rate > 0 ? rate : 1;
  const controlled = time !== undefined;
  const latest = useRef({ time, playing, onReady, clip, spd, tStart, loop });
  latest.current = { time, playing, onReady, clip, spd, tStart, loop };
  const syncRef = useRef<() => void>(() => {});

  useEffect(() => {
    const v = videoRef.current;
    if (IS_EXPORT || !v) return;
    let disposed = false;
    let ready = false;
    let frame = 0;
    let raf = 0;
    let starting = false;
    const setReady = (value: boolean) => {
      if (disposed || ready === value) return;
      ready = value;
      latest.current.onReady?.(value);
    };
    latest.current.onReady?.(false);

    // 播放时等呈现回调；暂停 seek 后可能已错过该回调，改在解码就绪后的绘制帧切换。
    const awaitFrame = () => {
      if (disposed || ready || raf || v.seeking || v.readyState < 2) return;
      const presented = () => {
        frame = raf = 0;
        if (!disposed && !v.seeking && v.readyState >= 2) setReady(true);
      };
      if (controlled && !latest.current.playing) {
        if (frame) v.cancelVideoFrameCallback(frame);
        frame = 0;
        raf = requestAnimationFrame(presented);
      } else if (frame) return;
      else if (typeof v.requestVideoFrameCallback === "function") frame = v.requestVideoFrameCallback(presented);
      else raf = requestAnimationFrame(presented);
    };
    const sync = () => {
      const p = latest.current;
      if (disposed || !controlled || !Number.isFinite(v.duration) || v.duration <= 0) return;
      const run = p.playing === true;
      v.playbackRate = p.spd;
      if (!run && !v.paused) v.pause();
      // seek 期间只更新 latest；完成后再跳到最新位置，不反复中断解码。
      if (v.seeking) return;
      let target = p.clip + Math.max(0, (p.time ?? 0) - (p.tStart ?? 0)) * p.spd;
      if (p.loop && target > v.duration) target = p.clip + ((target - p.clip) % Math.max(v.duration - p.clip, 0.1));
      target = Math.min(target, Math.max(0, v.duration - 0.001));
      if (Math.abs(v.currentTime - target) > (run ? 0.25 : 0.015)) {
        setReady(false);
        v.currentTime = target;
      } else awaitFrame();
      if (run && v.paused && !v.ended && !starting) {
        starting = true;
        void v.play().catch(() => {}).finally(() => { starting = false; });
      }
    };
    const loaded = () => { sync(); awaitFrame(); };
    const seeking = () => { setReady(false); };
    const failed = () => { setReady(false); };
    syncRef.current = sync;
    v.addEventListener("loadedmetadata", sync);
    v.addEventListener("loadeddata", loaded);
    v.addEventListener("canplay", loaded);
    v.addEventListener("seeked", loaded);
    v.addEventListener("seeking", seeking);
    v.addEventListener("error", failed);
    sync();
    awaitFrame();
    return () => {
      disposed = true;
      syncRef.current = () => {};
      if (frame) v.cancelVideoFrameCallback(frame);
      if (raf) cancelAnimationFrame(raf);
      v.removeEventListener("loadedmetadata", sync);
      v.removeEventListener("loadeddata", loaded);
      v.removeEventListener("canplay", loaded);
      v.removeEventListener("seeked", loaded);
      v.removeEventListener("seeking", seeking);
      v.removeEventListener("error", failed);
    };
  }, [src, controlled]);
  useEffect(() => { syncRef.current(); }, [time, playing, clip, spd, tStart, loop]);

  if (IS_EXPORT) {
    // 挂载的第一帧也有图，避免导出脚本第一次 seek 时组件尚未挂上而空一帧。
    const frames = (window as unknown as { __VID_FRAMES?: Record<string, { dir: string; fps: number; count: number; dur: number; ext?: string }> }).__VID_FRAMES?.[src];
    const exportTime = time ?? ((window as unknown as { __fxExportMs?: number }).__fxExportMs ?? 0) / 1000;
    let target = clip + Math.max(0, exportTime - (tStart ?? 0)) * spd;
    if (loop && frames?.dur) target %= frames.dur;
    const index = frames ? Math.min(frames.count - 1, Math.floor(target * frames.fps)) : 0;
    const firstFrame = frames?.count ? `${frames.dir}/f_${String(index + 1).padStart(5, "0")}.${frames.ext ?? "jpg"}` : undefined;
    return (
      <img
        src={firstFrame}
        className={className}
        data-fx-vidimg
        data-fx-src={src}
        /* 片段偏移:把卡片起点往前挪 clip 秒,导出取帧就落在素材的 clip 秒处 */
        data-t-start={(tStart ?? 0) - clip / spd}
        {...(spd !== 1 ? { "data-fx-rate": String(spd) } : {})}
        {...(loop ? { "data-fx-loop": "1" } : {})}
        style={style}
        alt=""
      />
    );
  }
  return (
    <video
      ref={videoRef}
      className={className}
      data-fx-video
      {...(controlled ? { "data-fx-controlled": "1" } : {})}
      data-t-start={tStart ?? 0}
      /* 拖播放头后要把卡内录屏拉回正确位置,得知道素材起播秒和倍速(见 App.tsx alignCardVideos) */
      data-fx-clip={clip}
      data-fx-rate={spd}
      {...(loop ? { "data-fx-loop": "1" } : {})}
      src={src}
      muted
      playsInline
      preload="auto"
      autoPlay={time === undefined}
      loop={time === undefined}
      style={style}
      /* 刚上传完的文件偶发第一次请求落空:自动重试加载几次 */
      /* 片段偏移:预览里加载完直接跳到 clip 秒;循环回 0 时再跳回去 */
      onLoadedMetadata={(e) => {
        e.currentTarget.playbackRate = spd;
        if (clip) e.currentTarget.currentTime = clip;
      }}
      onCanPlay={(e) => { e.currentTarget.playbackRate = spd; }}
      onTimeUpdate={
        clip
          ? (e) => {
              const v = e.currentTarget;
              if (v.currentTime < clip - 0.05) v.currentTime = clip;
            }
          : undefined
      }
      onError={(e) => {
        const v = e.currentTarget;
        const n = Number(v.dataset.retry || 0);
        if (n < 3) {
          v.dataset.retry = String(n + 1);
          setTimeout(() => v.load(), 400);
        }
      }}
    />
  );
}

/**
 * 图/视频通用媒体槽:同一个参数位,填图片路径出图,填视频路径出会动的小窗
 * (证据素材本身要是活的)。
 * 视频预览时静音循环;导出时由 __seekVideos 按时间轴对位,data-fx-loop 表示循环短素材。
 */
export function MediaImg({
  src,
  className,
  tStart,
}: {
  src: string;
  className?: string;
  /** 时间轴导出用:所在卡片的 start(秒),循环素材按 (t-start)%时长 对位 */
  tStart?: number;
}) {
  if (isVideoSrc(src)) {
    return <FxVideo src={src} className={className} tStart={tStart} loop />;
  }
  return <img className={className} src={src} alt="" onError={imgRetry(src)} />;
}
