const MARKET = "BTC-USD";
const INTERVAL = "1h";
const HOUR_MS = 60 * 60 * 1000;
const EPSILON = 1e-8;
const PAPER_PORTFOLIO_ID = "paper-main";

export const PAPER_EXECUTION_CONFIG = Object.freeze({
  model: "paper-spot-next-eligible-open-v1",
  fee_bps: 10,
  slippage_bps: 5,
  live_capital_enabled: false,
  leverage_enabled: false,
  shorting_enabled: false,
});

export async function executePaperDecision(env, decision, options = {}) {
  return executePaperDecisionWithStore(createD1PaperStore(env), decision, options);
}

export async function executePaperDecisionWithStore(store, rawDecision, options = {}) {
  const now = normalizedIso(options.now || new Date(), "now");
  const decision = normalizeDecision(rawDecision, now);
  const decisionHash = await stableHash(decision);

  const existing = await store.getReceipt(decision.cycle_id);
  if (existing) {
    if (existing.decision_hash !== decisionHash) {
      throw new Error("paper_cycle_payload_mismatch");
    }
    return { ...parseResult(existing.result_json), replayed: true };
  }

  const duplicateDecision = await store.getOrderByDecision(decision.portfolio_id, decision.decision_id);
  if (duplicateDecision) {
    throw new Error("paper_decision_id_already_recorded");
  }

  const portfolio = await store.getPortfolio(decision.portfolio_id);
  if (!portfolio) {
    throw new Error("paper_portfolio_not_found");
  }
  if (portfolio.status !== "active") {
    throw new Error("paper_portfolio_not_active");
  }

  const position = await store.getPosition(decision.portfolio_id, decision.market);
  const signalCandle = await store.getCandle(decision.market, decision.signal_closed_at);
  if (!signalCandle) {
    throw new Error("paper_signal_candle_not_found");
  }

  let executionCandle = null;
  if (decision.action !== "hold") {
    executionCandle = await store.getEligibleExecutionCandle(
      decision.market,
      decision.signal_closed_at,
      decision.decision_at,
    );
    if (!executionCandle) {
      return {
        ok: false,
        paper_only: true,
        status: "pending_execution",
        cycle_id: decision.cycle_id,
        decision_id: decision.decision_id,
        signal_closed_at: decision.signal_closed_at,
        decision_at: decision.decision_at,
        replayed: false,
      };
    }
  }

  const transition = planPaperDecision({
    portfolio,
    position,
    decision,
    decisionHash,
    signalCandle,
    executionCandle,
    createdAt: now,
  });

  try {
    await store.commitTransition(transition);
  } catch (error) {
    const raced = await store.getReceipt(decision.cycle_id);
    if (raced) {
      if (raced.decision_hash !== decisionHash) {
        throw new Error("paper_cycle_payload_mismatch");
      }
      return { ...parseResult(raced.result_json), replayed: true };
    }
    if (error instanceof Error && /paper_portfolio_version_conflict/.test(error.message)) {
      throw new Error("paper_portfolio_version_conflict");
    }
    throw error;
  }

  return { ...transition.result, replayed: false };
}

export function planPaperDecision({
  portfolio: rawPortfolio,
  position: rawPosition,
  decision,
  decisionHash,
  signalCandle,
  executionCandle,
  createdAt,
}) {
  const portfolio = normalizePortfolio(rawPortfolio);
  const position = normalizePosition(rawPosition, portfolio.id, decision.market);
  const signal = normalizeCandle(signalCandle, decision.market);
  const execution = executionCandle ? normalizeCandle(executionCandle, decision.market) : null;

  if (signal.closed_at !== decision.signal_closed_at) {
    throw new Error("paper_signal_candle_mismatch");
  }

  if (execution) {
    const executionOpenAt = candleOpenAt(execution.closed_at);
    if (Date.parse(execution.closed_at) <= Date.parse(signal.closed_at)) {
      throw new Error("paper_same_candle_execution_forbidden");
    }
    if (Date.parse(executionOpenAt) < Date.parse(decision.decision_at)) {
      throw new Error("paper_execution_precedes_decision");
    }
  }

  const orderId = `paper-order:${decision.cycle_id}`;
  const fillId = `paper-fill:${decision.cycle_id}`;
  const valuationId = `paper-valuation:${decision.cycle_id}`;
  const newVersion = portfolio.version + 1;
  const order = {
    id: orderId,
    portfolio_id: portfolio.id,
    cycle_id: decision.cycle_id,
    decision_id: decision.decision_id,
    decision_hash: decisionHash,
    market: decision.market,
    side: decision.action,
    status: "held",
    signal_closed_at: decision.signal_closed_at,
    decision_at: decision.decision_at,
    execution_candle_closed_at: execution?.closed_at || null,
    requested_notional: decision.requested_notional_usd,
    requested_quantity: decision.requested_quantity,
    execution_model: PAPER_EXECUTION_CONFIG.model,
    fee_bps: PAPER_EXECUTION_CONFIG.fee_bps,
    slippage_bps: PAPER_EXECUTION_CONFIG.slippage_bps,
    rejection_reason: null,
    created_at: createdAt,
  };

  let nextPortfolio = { ...portfolio, version: newVersion, updated_at: createdAt };
  let nextPosition = { ...position, updated_at: createdAt };
  let fill = null;
  let cashEntries = [];
  let status = "held";
  let rejectionReason = null;
  let markCandle = signal;
  let valuedAt = decision.decision_at;

  if (decision.action === "buy") {
    if (!execution) {
      throw new Error("paper_execution_candle_required");
    }
    markCandle = execution;
    valuedAt = execution.closed_at;
    const price = execution.open * (1 + PAPER_EXECUTION_CONFIG.slippage_bps / 10000);
    const notional = decision.requested_notional_usd;
    const fee = notional * (PAPER_EXECUTION_CONFIG.fee_bps / 10000);
    const totalCost = notional + fee;

    if (totalCost > portfolio.cash_balance + EPSILON) {
      status = "rejected";
      rejectionReason = "insufficient_cash";
    } else {
      const quantity = notional / price;
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("paper_invalid_buy_quantity");
      }
      const existingCostBasis = position.quantity * position.average_cost;
      const newQuantity = position.quantity + quantity;
      const newAverageCost = (existingCostBasis + totalCost) / newQuantity;
      const newCash = clampZero(portfolio.cash_balance - totalCost);

      fill = {
        id: fillId,
        order_id: orderId,
        portfolio_id: portfolio.id,
        market: decision.market,
        side: "buy",
        fill_time: candleOpenAt(execution.closed_at),
        source_candle_closed_at: execution.closed_at,
        price,
        quantity,
        notional,
        fee,
        slippage_price_delta: price - execution.open,
        created_at: createdAt,
      };
      cashEntries = [
        cashEntry(decision.cycle_id, "notional", portfolio.id, orderId, fillId, "trade_notional", -notional, portfolio.cash_balance - notional, createdAt),
        cashEntry(decision.cycle_id, "fee", portfolio.id, orderId, fillId, "fee", -fee, newCash, createdAt),
      ];
      nextPortfolio = {
        ...nextPortfolio,
        cash_balance: newCash,
        total_fees: portfolio.total_fees + fee,
      };
      nextPosition = {
        ...nextPosition,
        quantity: newQuantity,
        average_cost: newAverageCost,
      };
      status = "filled";
    }
  } else if (decision.action === "sell") {
    if (!execution) {
      throw new Error("paper_execution_candle_required");
    }
    markCandle = execution;
    valuedAt = execution.closed_at;
    const quantity = decision.requested_quantity;

    if (quantity > position.quantity + EPSILON) {
      status = "rejected";
      rejectionReason = "insufficient_position";
    } else {
      const normalizedQuantity = Math.min(quantity, position.quantity);
      const price = execution.open * (1 - PAPER_EXECUTION_CONFIG.slippage_bps / 10000);
      const notional = normalizedQuantity * price;
      const fee = notional * (PAPER_EXECUTION_CONFIG.fee_bps / 10000);
      const netProceeds = notional - fee;
      const realized = netProceeds - normalizedQuantity * position.average_cost;
      const remainingQuantity = clampZero(position.quantity - normalizedQuantity);
      const newCash = portfolio.cash_balance + netProceeds;

      fill = {
        id: fillId,
        order_id: orderId,
        portfolio_id: portfolio.id,
        market: decision.market,
        side: "sell",
        fill_time: candleOpenAt(execution.closed_at),
        source_candle_closed_at: execution.closed_at,
        price,
        quantity: normalizedQuantity,
        notional,
        fee,
        slippage_price_delta: execution.open - price,
        created_at: createdAt,
      };
      cashEntries = [
        cashEntry(decision.cycle_id, "notional", portfolio.id, orderId, fillId, "trade_notional", notional, portfolio.cash_balance + notional, createdAt),
        cashEntry(decision.cycle_id, "fee", portfolio.id, orderId, fillId, "fee", -fee, newCash, createdAt),
      ];
      nextPortfolio = {
        ...nextPortfolio,
        cash_balance: newCash,
        realized_pnl: portfolio.realized_pnl + realized,
        total_fees: portfolio.total_fees + fee,
      };
      nextPosition = {
        ...nextPosition,
        quantity: remainingQuantity,
        average_cost: remainingQuantity === 0 ? 0 : position.average_cost,
        realized_pnl: position.realized_pnl + realized,
      };
      status = "filled";
    }
  }

  order.status = status;
  order.rejection_reason = rejectionReason;

  const snapshot = valuationSnapshot({
    id: valuationId,
    cycleId: decision.cycle_id,
    portfolio: nextPortfolio,
    position: nextPosition,
    markCandle,
    valuedAt,
    version: newVersion,
    createdAt,
  });

  assertCashTransition(portfolio.cash_balance, nextPortfolio.cash_balance, cashEntries);
  assertAccountingInvariant(nextPortfolio, nextPosition, snapshot);

  const result = {
    ok: status !== "rejected",
    paper_only: true,
    live_capital_enabled: false,
    cycle_id: decision.cycle_id,
    decision_id: decision.decision_id,
    decision_hash: decisionHash,
    portfolio_id: portfolio.id,
    portfolio_version: newVersion,
    market: decision.market,
    action: decision.action,
    status,
    rejection_reason: rejectionReason,
    signal_closed_at: decision.signal_closed_at,
    decision_at: decision.decision_at,
    execution_candle_closed_at: execution?.closed_at || null,
    fill_id: fill?.id || null,
    filled_price: fill?.price || null,
    filled_quantity: fill?.quantity || 0,
    filled_notional: fill?.notional || 0,
    fee: fill?.fee || 0,
    cash_balance: nextPortfolio.cash_balance,
    position_quantity: nextPosition.quantity,
    average_cost: nextPosition.average_cost,
    realized_pnl: nextPortfolio.realized_pnl,
    unrealized_pnl: snapshot.unrealized_pnl,
    total_fees: nextPortfolio.total_fees,
    equity: snapshot.equity,
    accounting_delta: snapshot.accounting_delta,
    reconciled: snapshot.reconciled === 1,
    execution_model: PAPER_EXECUTION_CONFIG.model,
  };

  return {
    order,
    fill,
    cashEntries,
    portfolioBefore: portfolio,
    portfolioAfter: nextPortfolio,
    positionAfter: nextPosition,
    snapshot,
    receipt: {
      cycle_id: decision.cycle_id,
      portfolio_id: portfolio.id,
      decision_id: decision.decision_id,
      decision_hash: decisionHash,
      order_id: orderId,
      status,
      expected_portfolio_version: portfolio.version,
      committed_portfolio_version: newVersion,
      result_json: JSON.stringify(result),
      created_at: createdAt,
    },
    result,
  };
}

export async function getPaperAccountSummary(env, portfolioId = PAPER_PORTFOLIO_ID) {
  const portfolio = await env.DB.prepare(
    `SELECT id, name, base_currency, initial_cash, cash_balance, realized_pnl,
            total_fees, status, version, created_at, updated_at
     FROM paper_portfolios WHERE id = ?`,
  ).bind(portfolioId).first();
  if (!portfolio) {
    return null;
  }

  const [position, snapshot, counts, cashLedger] = await Promise.all([
    env.DB.prepare(
      `SELECT portfolio_id, market, quantity, average_cost, realized_pnl, updated_at
       FROM paper_positions WHERE portfolio_id = ? AND market = ?`,
    ).bind(portfolioId, MARKET).first(),
    env.DB.prepare(
      `SELECT valued_at, source_candle_closed_at, cash_balance, position_quantity,
              average_cost, mark_price, market_value, realized_pnl, unrealized_pnl,
              total_fees, equity, accounting_delta, reconciled, portfolio_version
       FROM paper_valuation_snapshots
       WHERE portfolio_id = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    ).bind(portfolioId).first(),
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM paper_orders WHERE portfolio_id = ?) AS order_count,
         (SELECT COUNT(*) FROM paper_fills WHERE portfolio_id = ?) AS fill_count,
         (SELECT COUNT(*) FROM paper_cycle_receipts WHERE portfolio_id = ?) AS cycle_count`,
    ).bind(portfolioId, portfolioId, portfolioId).first(),
    env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS ledger_cash
       FROM paper_cash_ledger WHERE portfolio_id = ?`,
    ).bind(portfolioId).first(),
  ]);

  const normalizedPortfolio = normalizePortfolio(portfolio);
  const normalizedPosition = normalizePosition(position, portfolioId, MARKET);
  const ledgerCash = Number(cashLedger?.ledger_cash || 0);
  const cashDelta = normalizedPortfolio.cash_balance - ledgerCash;
  const snapshotReconciled = snapshot ? Number(snapshot.reconciled) === 1 : normalizedPortfolio.version === 0;

  return {
    paper_only: true,
    live_capital_enabled: false,
    portfolio_id: portfolioId,
    status: normalizedPortfolio.status,
    base_currency: normalizedPortfolio.base_currency,
    initial_cash: normalizedPortfolio.initial_cash,
    cash_balance: normalizedPortfolio.cash_balance,
    position_market: MARKET,
    position_quantity: normalizedPosition.quantity,
    average_cost: normalizedPosition.average_cost,
    realized_pnl: normalizedPortfolio.realized_pnl,
    unrealized_pnl: Number(snapshot?.unrealized_pnl || 0),
    total_fees: normalizedPortfolio.total_fees,
    equity: Number(snapshot?.equity ?? normalizedPortfolio.cash_balance),
    latest_mark_price: snapshot ? Number(snapshot.mark_price) : null,
    latest_valuation_at: snapshot?.valued_at || null,
    source_candle_closed_at: snapshot?.source_candle_closed_at || null,
    portfolio_version: normalizedPortfolio.version,
    order_count: Number(counts?.order_count || 0),
    fill_count: Number(counts?.fill_count || 0),
    cycle_count: Number(counts?.cycle_count || 0),
    cash_ledger_balance: ledgerCash,
    cash_ledger_delta: cashDelta,
    accounting_reconciled: snapshotReconciled && nearlyEqual(cashDelta, 0),
    execution_model: PAPER_EXECUTION_CONFIG.model,
  };
}

export async function commissionPaperLedger(env) {
  const store = createD1PaperStore(env);
  const buyCycleId = "stage2-production-buy-v1";
  let buyReceipt = await store.getReceipt(buyCycleId);
  let buy;

  if (buyReceipt) {
    buy = { ...parseResult(buyReceipt.result_json), replayed: true };
  } else {
    const candles = await latestCandles(env, 3);
    if (candles.length < 3) {
      throw new Error("paper_commission_requires_three_candles");
    }
    const [buySignal] = candles;
    buy = await executePaperDecisionWithStore(store, {
      cycle_id: buyCycleId,
      decision_id: "stage2-production-buy-decision-v1",
      portfolio_id: PAPER_PORTFOLIO_ID,
      market: MARKET,
      action: "buy",
      signal_closed_at: buySignal.closed_at,
      decision_at: buySignal.closed_at,
      requested_notional_usd: 100,
    });
  }

  if (buy.status !== "filled") {
    return {
      ok: false,
      paper_only: true,
      status: "buy_commission_not_filled",
      buy,
      sell: null,
      account: await getPaperAccountSummary(env),
    };
  }

  const sellCycleId = "stage2-production-sell-v1";
  const sellReceipt = await store.getReceipt(sellCycleId);
  let sell;
  if (sellReceipt) {
    sell = { ...parseResult(sellReceipt.result_json), replayed: true };
  } else {
    const sellSignalClosedAt = buy.execution_candle_closed_at;
    const sellExecution = await store.getEligibleExecutionCandle(
      MARKET,
      sellSignalClosedAt,
      sellSignalClosedAt,
    );
    if (!sellExecution) {
      return {
        ok: false,
        paper_only: true,
        status: "pending_sell_commission_execution",
        buy,
        sell: null,
        account: await getPaperAccountSummary(env),
      };
    }
    sell = await executePaperDecisionWithStore(store, {
      cycle_id: sellCycleId,
      decision_id: "stage2-production-sell-decision-v1",
      portfolio_id: PAPER_PORTFOLIO_ID,
      market: MARKET,
      action: "sell",
      signal_closed_at: sellSignalClosedAt,
      decision_at: sellSignalClosedAt,
      requested_quantity: buy.filled_quantity,
    });
  }

  const account = await getPaperAccountSummary(env);
  return {
    ok: buy.status === "filled"
      && sell.status === "filled"
      && account?.accounting_reconciled === true
      && account.position_quantity === 0,
    paper_only: true,
    live_capital_enabled: false,
    status: "completed",
    buy,
    sell,
    account,
  };
}

export function createMemoryPaperStore({
  portfolio,
  position,
  candles,
  receipts = [],
  orders = [],
}) {
  const state = {
    portfolio: normalizePortfolio(portfolio),
    position: normalizePosition(position, portfolio.id, MARKET),
    candles: candles.map((candle) => normalizeCandle(candle, MARKET)),
    receipts: new Map(receipts.map((receipt) => [receipt.cycle_id, receipt])),
    orders: new Map(orders.map((order) => [`${order.portfolio_id}:${order.decision_id}`, order])),
    fills: [],
    cashEntries: [],
    snapshots: [],
  };

  return {
    state,
    async getReceipt(cycleId) {
      return state.receipts.get(cycleId) || null;
    },
    async getOrderByDecision(portfolioId, decisionId) {
      return state.orders.get(`${portfolioId}:${decisionId}`) || null;
    },
    async getPortfolio(portfolioId) {
      return state.portfolio.id === portfolioId ? { ...state.portfolio } : null;
    },
    async getPosition(portfolioId, market) {
      if (state.position.portfolio_id === portfolioId && state.position.market === market) {
        return { ...state.position };
      }
      return null;
    },
    async getCandle(market, closedAt) {
      return state.candles.find((candle) => candle.market === market && candle.closed_at === closedAt) || null;
    },
    async getEligibleExecutionCandle(market, signalClosedAt, decisionAt) {
      return eligibleExecutionCandle(state.candles, market, signalClosedAt, decisionAt);
    },
    async commitTransition(transition) {
      if (state.receipts.has(transition.receipt.cycle_id)) {
        throw new Error("UNIQUE constraint failed: paper_cycle_receipts.cycle_id");
      }
      if (state.portfolio.version !== transition.receipt.expected_portfolio_version) {
        throw new Error("paper_portfolio_version_conflict");
      }
      state.orders.set(
        `${transition.order.portfolio_id}:${transition.order.decision_id}`,
        { ...transition.order },
      );
      if (transition.fill) {
        state.fills.push({ ...transition.fill });
      }
      state.cashEntries.push(...transition.cashEntries.map((entry) => ({ ...entry })));
      state.snapshots.push({ ...transition.snapshot });
      state.portfolio = { ...transition.portfolioAfter };
      state.position = { ...transition.positionAfter };
      state.receipts.set(transition.receipt.cycle_id, { ...transition.receipt });
    },
  };
}

function createD1PaperStore(env) {
  return {
    async getReceipt(cycleId) {
      return env.DB.prepare(
        `SELECT cycle_id, portfolio_id, decision_id, decision_hash, order_id, status,
                expected_portfolio_version, committed_portfolio_version, result_json, created_at
         FROM paper_cycle_receipts WHERE cycle_id = ?`,
      ).bind(cycleId).first();
    },
    async getOrderByDecision(portfolioId, decisionId) {
      return env.DB.prepare(
        `SELECT id, portfolio_id, decision_id, decision_hash, status
         FROM paper_orders WHERE portfolio_id = ? AND decision_id = ?`,
      ).bind(portfolioId, decisionId).first();
    },
    async getPortfolio(portfolioId) {
      return env.DB.prepare(
        `SELECT id, name, base_currency, initial_cash, cash_balance, realized_pnl,
                total_fees, status, version, created_at, updated_at
         FROM paper_portfolios WHERE id = ?`,
      ).bind(portfolioId).first();
    },
    async getPosition(portfolioId, market) {
      return env.DB.prepare(
        `SELECT portfolio_id, market, quantity, average_cost, realized_pnl, updated_at
         FROM paper_positions WHERE portfolio_id = ? AND market = ?`,
      ).bind(portfolioId, market).first();
    },
    async getCandle(market, closedAt) {
      return env.DB.prepare(
        `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
         FROM market_candles WHERE pair = ? AND interval = ? AND closed_at = ?`,
      ).bind(market, INTERVAL, closedAt).first();
    },
    async getEligibleExecutionCandle(market, signalClosedAt, decisionAt) {
      const rows = await env.DB.prepare(
        `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
         FROM market_candles
         WHERE pair = ? AND interval = ? AND closed_at > ?
         ORDER BY closed_at ASC
         LIMIT 72`,
      ).bind(market, INTERVAL, signalClosedAt).all();
      return eligibleExecutionCandle(rows.results || [], market, signalClosedAt, decisionAt);
    },
    async commitTransition(transition) {
      const statements = [
        env.DB.prepare(
          `INSERT INTO paper_orders (
             id, portfolio_id, cycle_id, decision_id, decision_hash, market, side, status,
             signal_closed_at, decision_at, execution_candle_closed_at, requested_notional,
             requested_quantity, execution_model, fee_bps, slippage_bps, rejection_reason, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          transition.order.id,
          transition.order.portfolio_id,
          transition.order.cycle_id,
          transition.order.decision_id,
          transition.order.decision_hash,
          transition.order.market,
          transition.order.side,
          transition.order.status,
          transition.order.signal_closed_at,
          transition.order.decision_at,
          transition.order.execution_candle_closed_at,
          transition.order.requested_notional,
          transition.order.requested_quantity,
          transition.order.execution_model,
          transition.order.fee_bps,
          transition.order.slippage_bps,
          transition.order.rejection_reason,
          transition.order.created_at,
        ),
      ];

      if (transition.fill) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO paper_fills (
               id, order_id, portfolio_id, market, side, fill_time, source_candle_closed_at,
               price, quantity, notional, fee, slippage_price_delta, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            transition.fill.id,
            transition.fill.order_id,
            transition.fill.portfolio_id,
            transition.fill.market,
            transition.fill.side,
            transition.fill.fill_time,
            transition.fill.source_candle_closed_at,
            transition.fill.price,
            transition.fill.quantity,
            transition.fill.notional,
            transition.fill.fee,
            transition.fill.slippage_price_delta,
            transition.fill.created_at,
          ),
        );
      }

      for (const entry of transition.cashEntries) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO paper_cash_ledger (
               id, portfolio_id, order_id, fill_id, entry_type, amount, balance_after, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            entry.id,
            entry.portfolio_id,
            entry.order_id,
            entry.fill_id,
            entry.entry_type,
            entry.amount,
            entry.balance_after,
            entry.created_at,
          ),
        );
      }

      statements.push(
        env.DB.prepare(
          `INSERT INTO paper_positions (
             portfolio_id, market, quantity, average_cost, realized_pnl, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(portfolio_id, market) DO UPDATE SET
             quantity = excluded.quantity,
             average_cost = excluded.average_cost,
             realized_pnl = excluded.realized_pnl,
             updated_at = excluded.updated_at`,
        ).bind(
          transition.positionAfter.portfolio_id,
          transition.positionAfter.market,
          transition.positionAfter.quantity,
          transition.positionAfter.average_cost,
          transition.positionAfter.realized_pnl,
          transition.positionAfter.updated_at,
        ),
        env.DB.prepare(
          `UPDATE paper_portfolios SET
             cash_balance = ?, realized_pnl = ?, total_fees = ?, status = ?,
             version = ?, last_cycle_id = ?, updated_at = ?
           WHERE id = ? AND version = ?`,
        ).bind(
          transition.portfolioAfter.cash_balance,
          transition.portfolioAfter.realized_pnl,
          transition.portfolioAfter.total_fees,
          transition.portfolioAfter.status,
          transition.portfolioAfter.version,
          transition.receipt.cycle_id,
          transition.portfolioAfter.updated_at,
          transition.portfolioAfter.id,
          transition.portfolioBefore.version,
        ),
        env.DB.prepare(
          `INSERT INTO paper_valuation_snapshots (
             id, cycle_id, portfolio_id, market, valued_at, source_candle_closed_at,
             cash_balance, position_quantity, average_cost, mark_price, market_value,
             realized_pnl, unrealized_pnl, total_fees, equity, accounting_delta,
             reconciled, portfolio_version, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          transition.snapshot.id,
          transition.snapshot.cycle_id,
          transition.snapshot.portfolio_id,
          transition.snapshot.market,
          transition.snapshot.valued_at,
          transition.snapshot.source_candle_closed_at,
          transition.snapshot.cash_balance,
          transition.snapshot.position_quantity,
          transition.snapshot.average_cost,
          transition.snapshot.mark_price,
          transition.snapshot.market_value,
          transition.snapshot.realized_pnl,
          transition.snapshot.unrealized_pnl,
          transition.snapshot.total_fees,
          transition.snapshot.equity,
          transition.snapshot.accounting_delta,
          transition.snapshot.reconciled,
          transition.snapshot.portfolio_version,
          transition.snapshot.created_at,
        ),
        env.DB.prepare(
          `INSERT INTO paper_cycle_receipts (
             cycle_id, portfolio_id, decision_id, decision_hash, order_id, status,
             expected_portfolio_version, committed_portfolio_version, result_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          transition.receipt.cycle_id,
          transition.receipt.portfolio_id,
          transition.receipt.decision_id,
          transition.receipt.decision_hash,
          transition.receipt.order_id,
          transition.receipt.status,
          transition.receipt.expected_portfolio_version,
          transition.receipt.committed_portfolio_version,
          transition.receipt.result_json,
          transition.receipt.created_at,
        ),
      );

      await env.DB.batch(statements);
    },
  };
}

function normalizeDecision(raw, now) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("paper_decision_object_required");
  }
  const allowed = new Set([
    "cycle_id",
    "decision_id",
    "portfolio_id",
    "market",
    "action",
    "signal_closed_at",
    "decision_at",
    "requested_notional_usd",
    "requested_quantity",
  ]);
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) {
      throw new Error(`paper_decision_unknown_field:${key}`);
    }
  }

  const decision = {
    cycle_id: boundedId(raw.cycle_id, "cycle_id"),
    decision_id: boundedId(raw.decision_id, "decision_id"),
    portfolio_id: boundedId(raw.portfolio_id || PAPER_PORTFOLIO_ID, "portfolio_id"),
    market: raw.market || MARKET,
    action: raw.action,
    signal_closed_at: normalizedIso(raw.signal_closed_at, "signal_closed_at"),
    decision_at: normalizedIso(raw.decision_at, "decision_at"),
    requested_notional_usd: nullablePositiveNumber(raw.requested_notional_usd, "requested_notional_usd"),
    requested_quantity: nullablePositiveNumber(raw.requested_quantity, "requested_quantity"),
  };

  if (decision.market !== MARKET) {
    throw new Error("paper_market_not_allowed");
  }
  if (!["buy", "sell", "hold"].includes(decision.action)) {
    throw new Error("paper_action_not_allowed");
  }
  if (Date.parse(decision.signal_closed_at) % HOUR_MS !== 0) {
    throw new Error("paper_signal_not_hour_aligned");
  }
  if (Date.parse(decision.decision_at) < Date.parse(decision.signal_closed_at)) {
    throw new Error("paper_decision_precedes_signal_close");
  }
  if (Date.parse(decision.decision_at) > Date.parse(now) + 1000) {
    throw new Error("paper_decision_in_future");
  }

  if (decision.action === "buy") {
    if (!(decision.requested_notional_usd > 0) || decision.requested_quantity !== null) {
      throw new Error("paper_buy_requires_notional_only");
    }
  } else if (decision.action === "sell") {
    if (!(decision.requested_quantity > 0) || decision.requested_notional_usd !== null) {
      throw new Error("paper_sell_requires_quantity_only");
    }
  } else if (decision.requested_notional_usd !== null || decision.requested_quantity !== null) {
    throw new Error("paper_hold_cannot_request_size");
  }

  return decision;
}

function normalizePortfolio(raw) {
  if (!raw) {
    throw new Error("paper_portfolio_required");
  }
  const portfolio = {
    id: String(raw.id),
    name: String(raw.name || ""),
    base_currency: String(raw.base_currency || "USD"),
    initial_cash: finiteNonNegative(raw.initial_cash, "initial_cash"),
    cash_balance: finiteNonNegative(raw.cash_balance, "cash_balance"),
    realized_pnl: finiteNumber(raw.realized_pnl, "realized_pnl"),
    total_fees: finiteNonNegative(raw.total_fees, "total_fees"),
    status: String(raw.status || "active"),
    version: integerNonNegative(raw.version, "version"),
    created_at: raw.created_at || null,
    updated_at: raw.updated_at || null,
  };
  if (portfolio.base_currency !== "USD") {
    throw new Error("paper_base_currency_not_allowed");
  }
  return portfolio;
}

function normalizePosition(raw, portfolioId, market) {
  if (!raw) {
    return {
      portfolio_id: portfolioId,
      market,
      quantity: 0,
      average_cost: 0,
      realized_pnl: 0,
      updated_at: null,
    };
  }
  const quantity = finiteNonNegative(raw.quantity, "position_quantity");
  const averageCost = finiteNonNegative(raw.average_cost, "average_cost");
  if (quantity === 0 && !nearlyEqual(averageCost, 0)) {
    throw new Error("paper_zero_position_has_cost");
  }
  return {
    portfolio_id: String(raw.portfolio_id),
    market: String(raw.market),
    quantity,
    average_cost: averageCost,
    realized_pnl: finiteNumber(raw.realized_pnl, "position_realized_pnl"),
    updated_at: raw.updated_at || null,
  };
}

function normalizeCandle(raw, market) {
  if (!raw) {
    throw new Error("paper_candle_required");
  }
  const candle = {
    market: String(raw.market || raw.pair),
    interval: String(raw.interval || INTERVAL),
    closed_at: normalizedIso(raw.closed_at, "candle_closed_at"),
    open: positiveNumber(raw.open, "candle_open"),
    high: positiveNumber(raw.high, "candle_high"),
    low: positiveNumber(raw.low, "candle_low"),
    close: positiveNumber(raw.close, "candle_close"),
    volume: finiteNonNegative(raw.volume, "candle_volume"),
    source: String(raw.source || ""),
  };
  if (candle.market !== market || candle.interval !== INTERVAL) {
    throw new Error("paper_candle_market_interval_mismatch");
  }
  if (Date.parse(candle.closed_at) % HOUR_MS !== 0) {
    throw new Error("paper_candle_not_hour_aligned");
  }
  if (candle.high < Math.max(candle.open, candle.close, candle.low)) {
    throw new Error("paper_candle_invalid_high");
  }
  if (candle.low > Math.min(candle.open, candle.close, candle.high)) {
    throw new Error("paper_candle_invalid_low");
  }
  return candle;
}

function eligibleExecutionCandle(candles, market, signalClosedAt, decisionAt) {
  const signalMs = Date.parse(signalClosedAt);
  const decisionMs = Date.parse(decisionAt);
  return candles
    .map((candle) => normalizeCandle(candle, market))
    .filter((candle) => Date.parse(candle.closed_at) > signalMs)
    .sort((left, right) => left.closed_at.localeCompare(right.closed_at))
    .find((candle) => Date.parse(candleOpenAt(candle.closed_at)) >= decisionMs) || null;
}

function valuationSnapshot({
  id,
  cycleId,
  portfolio,
  position,
  markCandle,
  valuedAt,
  version,
  createdAt,
}) {
  const markPrice = markCandle.close;
  const marketValue = position.quantity * markPrice;
  const unrealizedPnl = position.quantity * (markPrice - position.average_cost);
  const equity = portfolio.cash_balance + marketValue;
  const accountingDelta = equity - (
    portfolio.initial_cash + portfolio.realized_pnl + unrealizedPnl
  );
  const tolerance = EPSILON * Math.max(1, Math.abs(equity));
  return {
    id,
    cycle_id: cycleId,
    portfolio_id: portfolio.id,
    market: position.market,
    valued_at: valuedAt,
    source_candle_closed_at: markCandle.closed_at,
    cash_balance: portfolio.cash_balance,
    position_quantity: position.quantity,
    average_cost: position.average_cost,
    mark_price: markPrice,
    market_value: marketValue,
    realized_pnl: portfolio.realized_pnl,
    unrealized_pnl: unrealizedPnl,
    total_fees: portfolio.total_fees,
    equity,
    accounting_delta: accountingDelta,
    reconciled: Math.abs(accountingDelta) <= tolerance ? 1 : 0,
    portfolio_version: version,
    created_at: createdAt,
  };
}

function assertCashTransition(before, after, entries) {
  const ledgerDelta = entries.reduce((sum, entry) => sum + entry.amount, 0);
  if (!nearlyEqual(before + ledgerDelta, after)) {
    throw new Error("paper_cash_ledger_not_reconciled");
  }
  let running = before;
  for (const entry of entries) {
    running += entry.amount;
    if (!nearlyEqual(running, entry.balance_after)) {
      throw new Error("paper_cash_entry_balance_mismatch");
    }
    if (running < -EPSILON) {
      throw new Error("paper_cash_cannot_be_negative");
    }
  }
}

function assertAccountingInvariant(portfolio, position, snapshot) {
  if (portfolio.cash_balance < -EPSILON) {
    throw new Error("paper_cash_cannot_be_negative");
  }
  if (position.quantity < -EPSILON) {
    throw new Error("paper_short_position_forbidden");
  }
  if (snapshot.reconciled !== 1) {
    throw new Error("paper_accounting_not_reconciled");
  }
}

function cashEntry(cycleId, suffix, portfolioId, orderId, fillId, entryType, amount, balanceAfter, createdAt) {
  if (!Number.isFinite(amount) || nearlyEqual(amount, 0)) {
    throw new Error("paper_cash_entry_amount_invalid");
  }
  return {
    id: `paper-cash:${cycleId}:${suffix}`,
    portfolio_id: portfolioId,
    order_id: orderId,
    fill_id: fillId,
    entry_type: entryType,
    amount,
    balance_after: clampZero(balanceAfter),
    created_at: createdAt,
  };
}

async function latestCandles(env, limit) {
  const rows = await env.DB.prepare(
    `SELECT pair AS market, interval, closed_at, open, high, low, close, volume, source
     FROM market_candles
     WHERE pair = ? AND interval = ?
     ORDER BY closed_at DESC
     LIMIT ?`,
  ).bind(MARKET, INTERVAL, limit).all();
  return (rows.results || [])
    .map((row) => normalizeCandle(row, MARKET))
    .sort((left, right) => left.closed_at.localeCompare(right.closed_at));
}

function candleOpenAt(closedAt) {
  return new Date(Date.parse(closedAt) - HOUR_MS).toISOString();
}

function boundedId(value, field) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]{1,120}$/.test(value)) {
    throw new Error(`paper_invalid_${field}`);
  }
  return value;
}

function normalizedIso(value, field) {
  const millis = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(millis)) {
    throw new Error(`paper_invalid_${field}`);
  }
  return new Date(millis).toISOString();
}

function nullablePositiveNumber(value, field) {
  if (value === undefined || value === null) {
    return null;
  }
  return positiveNumber(value, field);
}

function positiveNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`paper_invalid_${field}`);
  }
  return number;
}

function finiteNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`paper_invalid_${field}`);
  }
  return number;
}

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`paper_invalid_${field}`);
  }
  return number;
}

function integerNonNegative(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`paper_invalid_${field}`);
  }
  return number;
}

function clampZero(value) {
  return Math.abs(value) <= EPSILON ? 0 : value;
}

function nearlyEqual(left, right) {
  return Math.abs(left - right) <= EPSILON * Math.max(1, Math.abs(left), Math.abs(right));
}

function parseResult(value) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("paper_receipt_result_invalid");
  }
}

async function stableHash(value) {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${base64Url(new Uint8Array(digest))}`;
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
