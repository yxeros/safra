'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../domain.js');

const externalTrade = (date, duration, exchangeDays) => ({
  id: `job-${date}`, date, mode: 'others', duration, destination: 'Pablo',
  settlement: 'exchange', counterparty: 'Pablo', exchangeDays, stufasDone: 0, workers: ''
});

test('saldo de Pablo soma 1,5 dia feito para ele e abate 1 dia na estufada da família', () => {
  const entries = [
    externalTrade('2026-10-26', 'full', 1),
    externalTrade('2026-10-27', 'half', 0.5),
    { id: 'own-1', date: '2026-11-04', mode: 'others', alsoOurs: true, duration: 'full', workers: 'Eros, Ivonei, Pablo, Rafael', workerDeals: [] }
  ];
  const pablo = D.exchangeLedger(entries).find(person => person.name === 'Pablo');
  assert.equal(pablo.received, 1.5);
  assert.equal(pablo.repaid, 1);
  assert.equal(pablo.balance, 0.5);
});

test('Pablo em uma equipe de terceiros não reduz a troca; meio dia na produção própria reduz 0,5', () => {
  const entries = [
    externalTrade('2026-10-26', 'full', 1),
    { id: 'other-job', date: '2026-10-27', mode: 'others', duration: 'full', destination: 'Edinho', workers: 'Pablo' },
    { id: 'own-half', date: '2026-10-28', mode: 'ours', duration: 'half', workers: 'Pablo', workerDeals: [] }
  ];
  const pablo = D.exchangeLedger(entries).find(person => person.name === 'Pablo');
  assert.equal(pablo.received, 1);
  assert.equal(pablo.repaid, 0.5);
  assert.equal(pablo.balance, 0.5);
});

test('estufadas fracionadas são somadas separadas dos dias trabalhados', () => {
  const entries = [
    { date: '2026-10-26', mode: 'others', destination: 'Pablo', duration: 'full', stufasDone: 0.8, workers: 'Eros' },
    { date: '2026-10-27', mode: 'others', destination: 'Pablo', duration: 'half', stufasDone: 0.2, workers: 'Eros' },
    { date: '2026-10-28', mode: 'others', destination: 'Pablo', duration: 'full', stufasDone: 0.4, alsoOurs: true, workers: 'Eros' }
  ];
  assert.equal(D.externalStufaTotals(entries), 1);
  assert.equal(D.sumDays(entries.filter(D.thirdPartyRecord)), 1.5);
  const pablo = D.personalDaysByEmployer(entries).get('Pablo');
  assert.equal(pablo.days, 1.5);
  assert.equal(pablo.stufas, 1);
});

test('estufada familiar só entra no calendário pessoal de terceiros quando Eros trabalhou', () => {
  const erosWorked = { mode: 'ours', workers: 'Eros, Ivonei', duration: 'full' };
  const familyOnly = { mode: 'ours', workers: 'Ivonei, Silvani', duration: 'full' };
  assert.equal(D.visibleInMode(erosWorked, 'ours'), true);
  assert.equal(D.visibleInMode(erosWorked, 'others'), true);
  assert.equal(D.visibleInMode(familyOnly, 'ours'), true);
  assert.equal(D.visibleInMode(familyOnly, 'others'), false);
});

test('dias sem equipe antiga são assumidos como dias pessoais para terceiros', () => {
  const legacy = { mode: 'others', workers: '', duration: 'half' };
  const confirmedEmpty = { mode: 'others', workers: '', teamConfirmed: true, duration: 'half' };
  const someoneElse = { mode: 'others', workers: 'Rafael, Pablo', duration: 'full' };
  assert.equal(D.userWorked(legacy), true);
  assert.equal(D.userWorked(confirmedEmpty), false);
  assert.equal(D.userWorked(someoneElse), false);
});

test('a aba pessoal não mostra serviço para terceiros quando Eros não estava na equipe', () => {
  const notMine = { mode: 'others', duration: 'full', destination: 'Edinho', workers: 'Rafael, Pablo' };
  const mine = { mode: 'others', duration: 'half', destination: 'Edinho', workers: 'Eros, Rafael' };
  assert.equal(D.visibleInMode(notMine, 'others'), false);
  assert.equal(D.visibleInMode({ mode: 'others', workers: '', teamConfirmed: true }, 'others'), false);
  assert.equal(D.visibleInMode(mine, 'others'), true);
  assert.equal(D.sumDays([notMine, mine].filter(D.userWorked)), 0.5);
});

test('registro familiar ligado pela estufa não entra nas contagens dos patrões', () => {
  const linked = { mode: 'others', stufaId: 'family-01', duration: 'full', workers: 'Eros, Rafael', stufasDone: 0.6 };
  assert.equal(D.familyRecord(linked), true);
  assert.equal(D.visibleInMode(linked, 'ours'), true);
  assert.equal(D.visibleInMode(linked, 'others'), true);
  assert.equal(D.externalStufaTotals([linked]), 0);
});

test('pagamentos antigos da família recebem padrões individuais coerentes', () => {
  const record = { mode: 'ours', duration: 'half', workers: 'Eros, Ivonei, Pablo, Rafael', workerDeals: [] };
  const deals = D.participantDeals(record);
  assert.deepEqual(deals.map(deal => [deal.name, deal.settlement, deal.amount, deal.exchangeDays]), [
    ['Eros', 'none', 200, 0.5],
    ['Ivonei', 'none', 200, 0.5],
    ['Pablo', 'exchange', 200, 0.5],
    ['Rafael', 'cash', 200, 0.5]
  ]);
});

test('dias por pessoa unem Pai e Ivonei e atribuem lançamentos antigos sem equipe a Eros', () => {
  const records = [
    { mode: 'others', duration: 'full', workers: '' },
    { mode: 'others', duration: 'full', workers: '', teamConfirmed: true },
    { mode: 'ours', duration: 'half', workers: 'Pai, Rafael' },
    { mode: 'others', duration: 'half', workers: 'Eros, Ivonei' }
  ];
  const days = new Map(D.personDays(records).map(item => [item.name, item.days]));
  assert.equal(days.get('Eros'), 1.5);
  assert.equal(days.get('Ivonei'), 1);
  assert.equal(days.get('Rafael'), 0.5);
});

test('dias equivalentes por patrão e dias de estufa continuam separados', () => {
  const entries = [
    { mode: 'others', destination: 'Nelson', duration: 'half', stufasDone: 0.8, workers: 'Eros' },
    { mode: 'others', destination: 'Nelson', duration: 'half', stufasDone: 0.2, workers: 'Rafael' }
  ];
  const nelson = D.personalDaysByEmployer(entries).get('Nelson');
  assert.equal(nelson.days, 0.5);
  assert.equal(nelson.serviceDays, 1);
  assert.equal(nelson.stufas, 1);
});

test('estufadas da família são agrupadas pela safra correta', () => {
  const stufas = [
    { id: 'a', startDate: '2026-07-31' },
    { id: 'b', startDate: '2026-08-01' },
    { id: 'c', startDate: '2027-03-02' }
  ];
  assert.deepEqual(D.familyStufasInSeason(stufas, 2025).map(stufa => stufa.id), ['a']);
  assert.deepEqual(D.familyStufasInSeason(stufas, 2026).map(stufa => stufa.id), ['b', 'c']);
});

test('safra acompanha a virada de ano e começa em agosto', () => {
  assert.equal(D.seasonStartYear(new Date('2026-11-07T12:00:00')), 2026);
  assert.equal(D.seasonStartYear(new Date('2027-03-01T12:00:00')), 2026);
  assert.equal(D.seasonStartYear(new Date('2027-08-01T12:00:00')), 2027);
});
