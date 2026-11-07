(function (root) {
  'use strict';

  const DAY_UNITS = record => record?.duration === 'half' ? 0.5 : 1;
  const personKey = name => String(name || '').trim().toLocaleLowerCase('pt-BR');
  const canonicalPersonKey = name => personKey(name) === 'pai' ? 'ivonei' : personKey(name);
  const round = (value, places = 2) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 10 ** places) / 10 ** places : 0;
  };
  const formatNumber = value => round(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
  const familyRecord = record => record?.mode === 'ours' || Boolean(record?.alsoOurs) || (record?.mode === 'others' && Boolean(record?.stufaId));
  const thirdPartyRecord = record => record?.mode === 'others' && !familyRecord(record);

  function workerNames(record) {
    const fromField = Array.isArray(record?.workers)
      ? record.workers
      : String(record?.workers || '').split(',');
    const names = [...fromField, ...(record?.workerDeals || []).map(deal => deal.name)]
      .map(name => String(name || '').trim()).filter(Boolean);
    const seen = new Set();
    return names.filter(name => {
      const key = canonicalPersonKey(name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const hasWorker = (record, name) => workerNames(record).some(person => canonicalPersonKey(person) === canonicalPersonKey(name));
  const userWorked = record => {
    if (familyRecord(record)) return hasWorker(record, 'Eros');
    if (thirdPartyRecord(record)) return workerNames(record).length ? hasWorker(record, 'Eros') : record?.teamConfirmed !== true;
    return false;
  };
  const sumDays = records => round((records || []).reduce((sum, record) => sum + DAY_UNITS(record), 0));

  function participantDeals(record) {
    const existing = new Map((record?.workerDeals || []).map(deal => [canonicalPersonKey(deal.name), deal]));
    return workerNames(record).map(name => {
      const prior = existing.get(canonicalPersonKey(name));
      if (prior) return { ...prior, name };
      const key = personKey(name);
      const settlement = ['eros', 'pai', 'ivonei', 'silvani'].includes(key) ? 'none' : key === 'pablo' ? 'exchange' : 'cash';
      return {
        name,
        settlement,
        amount: record?.duration === 'half' ? 200 : 400,
        exchangeDays: DAY_UNITS(record),
        paid: false,
        amountDefaulted: true,
        exchangeDaysDefaulted: true
      };
    });
  }

  function seasonStartYear(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    return d.getMonth() >= 7 ? d.getFullYear() : d.getFullYear() - 1;
  }

  function recordSeasonYear(record) {
    const parts = String(record?.date || record?.startDate || '').split('-').map(Number);
    if (parts.length < 2 || !parts[0] || parts[1] < 1 || parts[1] > 12) return null;
    return parts[1] >= 8 ? parts[0] : parts[0] - 1;
  }

  function inSeason(record, seasonYear = seasonStartYear(new Date())) {
    return recordSeasonYear(record) === seasonYear;
  }

  function familyStufasInSeason(stufas, seasonYear = seasonStartYear(new Date())) {
    return (stufas || []).filter(stufa => recordSeasonYear(stufa) === seasonYear);
  }

  function visibleInMode(record, mode) {
    if (mode === 'ours') return familyRecord(record);
    if (mode === 'others') return (thirdPartyRecord(record) && userWorked(record)) || (familyRecord(record) && hasWorker(record, 'Eros'));
    return record?.mode === mode;
  }

  function externalStufaTotals(records) {
    return round((records || []).filter(thirdPartyRecord).reduce((sum, record) => sum + Math.max(0, Number(record.stufasDone) || 0), 0));
  }

  function personalDaysByEmployer(records) {
    const totals = new Map();
    for (const record of (records || []).filter(thirdPartyRecord)) {
      const employer = record.destination || 'Sem patrão';
      if (!totals.has(employer)) totals.set(employer, { days: 0, serviceDays: 0, stufas: 0, paid: 0, pending: 0 });
      const item = totals.get(employer);
      item.serviceDays += DAY_UNITS(record);
      if (userWorked(record)) item.days += DAY_UNITS(record);
      item.stufas += Math.max(0, Number(record.stufasDone) || 0);
      if (record.paid) item.paid += Number(record.amount) || 0;
      else if (record.settlement === 'cash') item.pending += Number(record.amount) || 0;
    }
    return new Map([...totals].map(([name, item]) => [name, {
      days: round(item.days), serviceDays: round(item.serviceDays), stufas: round(item.stufas),
      paid: round(item.paid), pending: round(item.pending)
    }]));
  }

  function personDays(records) {
    const totals = new Map();
    for (const record of (records || []).filter(record => familyRecord(record) || thirdPartyRecord(record))) {
      const people = workerNames(record);
      if (!people.length && thirdPartyRecord(record) && record?.teamConfirmed !== true) people.push('Eros');
      for (const name of people) {
        const key = canonicalPersonKey(name);
        const label = key === 'ivonei' ? 'Ivonei' : name;
        const current = totals.get(key) || { name: label, days: 0 };
        current.days += DAY_UNITS(record);
        totals.set(key, current);
      }
    }
    return [...totals.values()].map(item => ({ ...item, days: round(item.days) })).sort((a, b) => b.days - a.days || a.name.localeCompare(b.name, 'pt-BR'));
  }

  function exchangeLedger(records) {
    const ledger = new Map();
    const get = name => {
      const key = canonicalPersonKey(name);
      if (!key) return null;
      if (!ledger.has(key)) ledger.set(key, { name: key === 'ivonei' ? 'Ivonei' : String(name).trim(), received: 0, repaid: 0, items: [] });
      return ledger.get(key);
    };
    const amount = (value, fallback) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? fallback : Math.max(0, Number(value));
    const household = new Set(['eros', 'pai', 'ivonei', 'silvani']);

    for (const record of records || []) {
      if (thirdPartyRecord(record) && record.settlement === 'exchange') {
        const counterparty = String(record.counterparty || '').trim();
        const debtor = household.has(personKey(counterparty)) ? record.destination : (counterparty || record.destination);
        const item = get(debtor);
        if (item) {
          const days = amount(record.exchangeDays, DAY_UNITS(record));
          item.received += days;
          item.items.push({ date: record.date, days, type: 'A receber', record });
        }
      }

      if (!familyRecord(record)) continue;
      const deals = participantDeals(record);
      if (hasWorker(record, 'Pablo')) {
        const pabloDeal = deals.find(deal => personKey(deal.name) === 'pablo');
        const days = pabloDeal?.settlement === 'exchange' ? amount(pabloDeal.exchangeDays, DAY_UNITS(record)) : DAY_UNITS(record);
        const item = get('Pablo');
        item.repaid += days;
        item.items.push({ date: record.date, days, type: 'Devolvido', record });
      }
      for (const deal of deals) {
        if (personKey(deal.name) === 'pablo' || deal.settlement !== 'exchange') continue;
        const item = get(deal.name);
        if (!item) continue;
        const days = amount(deal.exchangeDays, DAY_UNITS(record));
        item.repaid += days;
        item.items.push({ date: record.date, days, type: 'Devolvido', record });
      }
    }

    return [...ledger.values()].map(item => ({
      ...item,
      received: round(item.received),
      repaid: round(item.repaid),
      balance: round(item.received - item.repaid),
      items: item.items.sort((a, b) => a.date.localeCompare(b.date))
    })).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }

  const api = {
    DAY_UNITS, familyRecord, thirdPartyRecord, workerNames, hasWorker, userWorked,
    sumDays, round, formatNumber, participantDeals, seasonStartYear, recordSeasonYear,
    inSeason, familyStufasInSeason, visibleInMode, externalStufaTotals,
    personalDaysByEmployer, personDays, exchangeLedger
  };
  root.SafraDomain = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
