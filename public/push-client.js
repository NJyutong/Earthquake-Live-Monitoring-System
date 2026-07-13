(function initQuakePush(global) {
  'use strict';

  const WORKER_URL = '/push-sw.js';
  const WORKER_SCOPE = '/';
  const WORKER_ACTIVATION_TIMEOUT_MS = 12000;
  const API_TIMEOUT_MS = 8000;
  const TEST_RESULT_TIMEOUT_MS = 45000;

  function isSecurePushContext() {
    return global.location.protocol === 'https:' && global.isSecureContext === true;
  }

  function supported() {
    return 'Notification' in global
      && 'serviceWorker' in navigator
      && 'PushManager' in global;
  }

  function createClientError(message, code, cause) {
    const error = new Error(message);
    error.code = code || 'push_client_error';
    error.userMessage = message;
    if (cause) error.cause = cause;
    return error;
  }

  function requestTimeoutSignal(timeoutMs) {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;
  }

  function delay(milliseconds) {
    return new Promise(resolve => global.setTimeout(resolve, milliseconds));
  }

  async function requestPermission() {
    assertPushEnvironment();
    let permission = Notification.permission;
    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
      } catch (error) {
        throw createClientError('浏览器未能完成通知权限请求，请在网站权限中手动允许通知后重试。', 'permission_request_failed', error);
      }
    }
    if (permission !== 'granted') {
      const error = createClientError('浏览器没有授予通知权限，请在地址栏的网站权限中允许“通知”后重试。', 'permission_denied');
      error.name = 'NotAllowedError';
      throw error;
    }
    return permission;
  }

  function assertPushEnvironment() {
    if (!isSecurePushContext()) {
      throw createClientError('后台推送仅在 HTTPS 页面可用，请通过 HTTPS 地址重新打开本站。', 'https_required');
    }
    if (!supported()) {
      throw createClientError('当前浏览器不支持 Service Worker 或 Push API，无法建立后台推送。', 'push_unsupported');
    }
  }

  async function fetchJson(url, options, failureMessage) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw createClientError(failureMessage, 'push_api_unreachable', error);
    }
    const isJson = String(response.headers.get('content-type') || '').includes('application/json');
    const data = isJson ? await response.json().catch(() => ({})) : {};
    return { response, data, isJson };
  }

  function workerPath(worker) {
    if (!worker || !worker.scriptURL) return '';
    try {
      const url = new URL(worker.scriptURL, global.location.origin);
      return url.origin === global.location.origin ? url.pathname : '';
    } catch (_error) {
      return '';
    }
  }

  function projectWorker(registration) {
    const workers = [registration && registration.active, registration && registration.waiting, registration && registration.installing];
    return workers.find(worker => ['/push-sw.js', '/sw.js'].includes(workerPath(worker))) || null;
  }

  async function waitForPushWorkerActivation(registration) {
    const deadline = Date.now() + WORKER_ACTIVATION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const active = registration && registration.active;
      if (workerPath(active) === '/push-sw.js' && active.state === 'activated') return registration;
      await delay(100);
    }
    const error = createClientError('推送组件未能在规定时间内完成更新，请重新加载页面后重试。', 'worker_activation_timeout');
    error.name = 'InvalidStateError';
    throw error;
  }

  async function removeServerSubscription(endpoint) {
    if (!endpoint) return;
    await fetch('/push/unsubscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: requestTimeoutSignal(API_TIMEOUT_MS),
      body: JSON.stringify({ endpoint })
    }).catch(() => {});
  }

  async function resetProjectWorkerRegistration() {
    const registration = await navigator.serviceWorker.getRegistration(WORKER_SCOPE);
    if (!registration) return;
    const knownWorker = projectWorker(registration);
    if (!knownWorker) return;
    const subscription = await registration.pushManager.getSubscription().catch(() => null);
    if (subscription) {
      await removeServerSubscription(subscription.endpoint);
      await subscription.unsubscribe().catch(() => false);
    }
    await registration.unregister().catch(() => false);
    await delay(300);
  }

  async function registerPushWorker(reset) {
    if (reset) await resetProjectWorkerRegistration();
    const registration = await navigator.serviceWorker.register(WORKER_URL, {
      scope: WORKER_SCOPE,
      updateViaCache: 'none'
    });
    await registration.update().catch(() => {});
    await waitForPushWorkerActivation(registration);
    await Promise.race([
      navigator.serviceWorker.ready,
      delay(WORKER_ACTIVATION_TIMEOUT_MS).then(() => {
        const error = createClientError('浏览器未能准备好推送组件，请重新加载页面后重试。', 'worker_ready_timeout');
        error.name = 'InvalidStateError';
        throw error;
      })
    ]);
    return registration;
  }

  function urlBase64ToUint8Array(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = global.atob(base64);
    return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
  }

  function subscriptionUsesKey(subscription, expectedKey) {
    const current = subscription && subscription.options && subscription.options.applicationServerKey;
    if (!current) return false;
    const actual = new Uint8Array(current);
    if (actual.length !== expectedKey.length) return false;
    return actual.every((value, index) => value === expectedKey[index]);
  }

  function repairableSubscriptionError(error) {
    return Boolean(error && (error.name === 'AbortError' || error.name === 'InvalidStateError'));
  }

  async function subscribeWithRepair(applicationServerKey) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const registration = await registerPushWorker(attempt === 1);
        let subscription = await registration.pushManager.getSubscription();
        if (subscription && !subscriptionUsesKey(subscription, applicationServerKey)) {
          await removeServerSubscription(subscription.endpoint);
          const removed = await subscription.unsubscribe().catch(() => false);
          if (!removed) {
            const error = new Error('The previous push subscription could not be removed');
            error.name = 'InvalidStateError';
            throw error;
          }
          subscription = null;
        }
        subscription = subscription || await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
        return { registration, subscription };
      } catch (error) {
        if (attempt === 0 && repairableSubscriptionError(error)) continue;
        if (error && typeof error === 'object') {
          error.pushStage = 'browser-subscription';
          error.pushRepairAttempted = attempt === 1;
        }
        throw error;
      }
    }
    throw createClientError('浏览器推送订阅建立失败。', 'subscription_failed');
  }

  function normalizedClientPath(value) {
    return value === '/mobile.html' ? '/mobile.html' : '/';
  }

  async function ensureSubscription(options = {}) {
    assertPushEnvironment();
    if (Notification.permission !== 'granted') {
      const error = createClientError('请先允许浏览器通知权限，再启用后台推送。', 'permission_required');
      error.name = 'NotAllowedError';
      throw error;
    }

    const keyResult = await fetchJson('/push/public-key', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: requestTimeoutSignal(API_TIMEOUT_MS)
    }, '无法读取服务器推送配置，请检查与服务器的连接后重试。');
    if (!keyResult.response.ok || !keyResult.data.supported || !keyResult.data.publicKey) {
      throw createClientError(
        keyResult.data.message || `服务器推送配置不可用（HTTP ${keyResult.response.status}）。`,
        'push_server_not_ready'
      );
    }

    let applicationServerKey;
    try {
      applicationServerKey = urlBase64ToUint8Array(keyResult.data.publicKey);
    } catch (error) {
      throw createClientError('服务器返回的 VAPID 公钥格式无效，请检查服务端配置。', 'invalid_vapid_public_key', error);
    }
    const context = await subscribeWithRepair(applicationServerKey);
    const subscribeResult = await fetchJson('/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: requestTimeoutSignal(API_TIMEOUT_MS),
      body: JSON.stringify({
        subscription: context.subscription.toJSON ? context.subscription.toJSON() : context.subscription,
        threshold: options.threshold,
        area: options.area || {},
        userLocation: options.userLocation || null,
        clientPath: normalizedClientPath(options.clientPath)
      })
    }, '浏览器订阅已建立，但暂时无法同步到服务器，请检查网络后重试。');
    if (!subscribeResult.response.ok || !subscribeResult.data.ok) {
      throw createClientError(
        subscribeResult.data.message || `服务器未接受浏览器推送订阅（HTTP ${subscribeResult.response.status}）。`,
        'subscription_rejected'
      );
    }
    return context;
  }

  function finiteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function eventPayload(event) {
    if (!event || !Number.isFinite(Number(event.magnitude))) {
      throw createClientError('当前地震信息缺少有效震级，无法发送设备通知。', 'invalid_push_event');
    }
    return {
      eventKey: String(event.eventKey || '').slice(0, 160),
      eventId: String(event.eventId || '').slice(0, 160),
      source: String(event.source || '').slice(0, 80),
      sourceLabel: String(event.sourceLabel || '').slice(0, 80),
      location: String(event.location || event.placeName || '').slice(0, 160),
      magnitude: finiteNumber(event.magnitude),
      depth: finiteNumber(event.depth),
      latitude: finiteNumber(event.latitude),
      longitude: finiteNumber(event.longitude),
      intensity: finiteNumber(event.intensity),
      originTime: String(event.originTime || '').slice(0, 64),
      receivedAt: String(event.receivedAt || '').slice(0, 64)
    };
  }

  async function invalidateSubscription(subscription) {
    if (!subscription) return;
    await removeServerSubscription(subscription.endpoint);
    await subscription.unsubscribe().catch(() => false);
  }

  async function waitForTestResult(testId) {
    const deadline = Date.now() + TEST_RESULT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await delay(1000);
      const result = await fetchJson(`/push/test-status?id=${encodeURIComponent(testId)}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: requestTimeoutSignal(API_TIMEOUT_MS)
      }, '无法读取设备通知发送结果，请检查服务器连接。');
      if (!result.response.ok) {
        throw createClientError(result.data.message || `设备通知结果查询失败（HTTP ${result.response.status}）。`, 'push_test_status_failed');
      }
      if (result.data.completed || result.data.state === 'completed') return result.data;
    }
    throw createClientError('设备通知发送结果等待超时，请检查服务器推送日志。', 'push_test_timeout');
  }

  async function sendEvent(event, options = {}) {
    await requestPermission();
    const context = await ensureSubscription(options);
    const result = await fetchJson('/push/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      signal: requestTimeoutSignal(API_TIMEOUT_MS),
      body: JSON.stringify({
        endpoint: context.subscription.endpoint,
        event: eventPayload(event),
        userLocation: options.userLocation || null
      })
    }, '设备通知请求未能到达服务器，请检查网络后重试。');
    if (!result.response.ok || !result.data.ok) {
      if (result.data.resetSubscription) await invalidateSubscription(context.subscription);
      const fallback = result.isJson
        ? '服务端未能接受设备通知请求。'
        : `设备通知请求被网关拒绝（HTTP ${result.response.status}）。`;
      throw createClientError(result.data.message || fallback, 'push_test_rejected');
    }

    const delivery = result.data.accepted && result.data.testId
      ? await waitForTestResult(result.data.testId)
      : result.data;
    if (delivery.resetSubscription) await invalidateSubscription(context.subscription);
    if (!delivery.ok) {
      throw createClientError(delivery.message || '服务端未能把通知发送到当前设备。', delivery.code || 'push_delivery_failed');
    }
    return { ...delivery, subscription: context.subscription };
  }

  async function unsubscribe() {
    if (!('serviceWorker' in navigator) || !('PushManager' in global)) return;
    const registration = await navigator.serviceWorker.getRegistration(WORKER_SCOPE);
    const subscription = registration && await registration.pushManager.getSubscription();
    if (!subscription) return;
    await removeServerSubscription(subscription.endpoint);
    await subscription.unsubscribe().catch(() => false);
  }

  function browserPushService() {
    const agent = navigator.userAgent || '';
    if (/Edg\//.test(agent)) {
      return {
        label: 'Microsoft Edge / WNS',
        host: '*.notify.windows.com:443',
        extra: '受管设备可启用 ForceBuiltInPushMessagingClient 策略后重启 Edge。'
      };
    }
    if (/(?:Chrome|CriOS)\//.test(agent)) return { label: 'Chrome / FCM', host: 'fcm.googleapis.com:443', extra: '' };
    if (/Firefox\//.test(agent)) return { label: 'Firefox / Mozilla Push', host: '*.push.services.mozilla.com:443', extra: '' };
    if (/Safari\//.test(agent)) return { label: 'Safari / Apple Web Push', host: '*.push.apple.com:443', extra: '' };
    return { label: '浏览器厂商推送服务', host: '对应推送服务的 443 端口', extra: '' };
  }

  function errorMessage(error) {
    if (error && error.userMessage) return error.userMessage;
    if (error && error.name === 'NotAllowedError') {
      return '通知权限已被浏览器阻止，请在网站权限中允许通知后重试。';
    }
    if (error && (error.name === 'AbortError' || error.name === 'InvalidStateError')) {
      const service = browserPushService();
      const resetText = error.pushRepairAttempted ? '已自动重建推送组件，但' : '';
      const extra = service.extra ? ` ${service.extra}` : '';
      return `${resetText}浏览器仍无法连接 ${service.label}。请检查设备 DNS、代理和防火墙是否允许 ${service.host}。${extra} 此连接由用户设备发起，Cloudflare Tunnel 不能代替浏览器建立订阅。`;
    }
    return '后台推送订阅失败，请检查 HTTPS、浏览器通知权限和设备网络。';
  }

  function refreshExistingWorker() {
    if (!('serviceWorker' in navigator) || !navigator.serviceWorker.getRegistration) return;
    navigator.serviceWorker.getRegistration(WORKER_SCOPE).then(registration => {
      if (registration && workerPath(registration.active) === '/push-sw.js') registration.update().catch(() => {});
    }).catch(() => {});
  }

  global.QuakePush = Object.freeze({
    supported,
    isSecurePushContext,
    requestPermission,
    ensureSubscription,
    sendEvent,
    unsubscribe,
    errorMessage,
    refreshExistingWorker
  });
})(window);
