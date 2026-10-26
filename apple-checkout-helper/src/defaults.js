/* defaults.js —— 默认配置，content script 和配置页共用一份 */
(function () {
  'use strict';
  const DEFAULTS = {
    mode: 'pickup',
    name: '', firstName: '', lastName: '', phone: '', email: '', idCard: '',
    province: '', city: '', district: '', street: '', street2: '', postal: '', company: '',
    invoice: { enabled: false, type: 'personal', title: '', taxNo: '' },
    pickup: {
      storeKeyword: '', storeName: '', legalLastName: '', legalFirstName: '', idLast4: '', datePreference: '',
      useDifferentContact: false, contactName: '', contactPhone: '', autoSelectStore: true, autoPickTime: true
    },
    payment: { method: 'wechat', mode: 'auto' },
    // autoPlaceOrder：到检查订单页自动点「立即下单」，会真实下单，默认关闭
    behavior: { clickNext: true, autoAdvance: true, delayMs: 120, maxSteps: 8, autoPlaceOrder: false, autoStart: false },
    overrides: []
  };

  // 深合并：对象递归合并，数组和基本类型直接覆盖
  function merge(base, patch) {
    const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
    if (!patch || typeof patch !== 'object') return out;
    for (const k of Object.keys(patch)) {
      const v = patch[k];
      if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(out[k] || {}, v);
      else out[k] = v;
    }
    return out;
  }

  window.__AF_DEFAULTS = DEFAULTS;
  window.__AF_MERGE = merge;
})();
