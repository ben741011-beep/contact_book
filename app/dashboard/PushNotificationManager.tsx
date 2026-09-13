"use client";

import { useEffect, useState } from "react";

type PushState =
  | "loading"
  | "ios-install-required"
  | "insecure"
  | "unsupported"
  | "disabled"
  | "denied"
  | "enabled";

function urlBase64ToUint8Array(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export default function PushNotificationManager() {
  const [state, setState] = useState<PushState>("loading");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    let active = true;
    async function initialize() {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
      if (active) {
        setIsIOS(ios);
        setIsStandalone(standalone);
      }
      if (ios && !standalone) {
        if (active) setState("ios-install-required");
        return;
      }
      if (!window.isSecureContext) {
        if (active) setState("insecure");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        if (active) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (active) setState("denied");
        return;
      }
      try {
        const [registration, result] = await Promise.all([
          navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }),
          fetch("/api/push-subscriptions", { cache: "no-store" }).then((response) => response.json()),
        ]);
        const subscription = await registration.pushManager.getSubscription();
        if (active) setState(subscription && result.subscriptionCount > 0 ? "enabled" : "disabled");
      } catch {
        if (active) setState("disabled");
      }
    }
    void initialize();
    return () => {
      active = false;
    };
  }, []);

  async function enableNotifications() {
    setPending(true);
    setMessage("");
    try {
      if (isIOS && !isStandalone) {
        throw new Error("iPhone／iPad 請先用 Safari 將網站加入主畫面，再從主畫面開啟通知。");
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey || publicKey.startsWith("replace-")) {
        throw new Error("網站尚未完成推播金鑰設定，請聯絡管理者。");
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "disabled");
        throw new Error("你尚未允許瀏覽器通知。");
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));
      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "無法儲存推播設定");
      setState("enabled");
      setMessage("此裝置已開啟聯絡簿通知。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法開啟通知");
    } finally {
      setPending(false);
    }
  }

  async function disableNotifications() {
    setPending(true);
    setMessage("");
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        const result = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(result.error ?? "無法移除推播設定");
        await subscription.unsubscribe();
      }
      setState("disabled");
      setMessage("此裝置已關閉聯絡簿通知。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "無法關閉通知");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="push-settings" aria-labelledby="push-settings-title">
      <div>
        <p className="section-kicker">NOTIFICATIONS</p>
        <h2 id="push-settings-title">聯絡簿即時通知</h2>
        <p>
          {state === "enabled"
            ? "此裝置會在老師發布聯絡簿時收到提醒。"
            : "主動開啟後，即使沒有停留在網站也能收到新聯絡簿提醒。"}
        </p>
        {state === "ios-install-required" ? (
          <small>iPhone／iPad：請在 Safari 點「分享」→「加入主畫面」，再從主畫面開啟本網站。</small>
        ) : null}
        {state === "insecure" ? (
          <small>Web Push 需要 HTTPS 安全連線；目前的區網 HTTP 測試網址無法開啟通知。</small>
        ) : null}
        {state === "denied" ? (
          <small>瀏覽器已封鎖通知，請到網站或系統通知設定中重新允許。</small>
        ) : null}
        {state === "unsupported" ? <small>目前瀏覽器不支援 Web Push 通知。</small> : null}
        {message ? <small className="push-message" role="status">{message}</small> : null}
      </div>
      {state === "enabled" ? (
        <button className="ghost-button" type="button" disabled={pending} onClick={disableNotifications}>
          {pending ? "關閉中…" : "關閉此裝置通知"}
        </button>
      ) : (
        <button
          className="primary-button"
          type="button"
          disabled={
            pending ||
            state === "loading" ||
            state === "ios-install-required" ||
            state === "insecure" ||
            state === "unsupported" ||
            state === "denied"
          }
          onClick={enableNotifications}
        >
          {pending ? "開啟中…" : state === "loading" ? "檢查中…" : "開啟通知"}
        </button>
      )}
    </section>
  );
}
