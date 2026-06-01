import { useQuery, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useEffect, useMemo } from 'react';

/**
 * Hook centralizado para carregar e sincronizar linhas orçamentárias / rubricas
 * Todas as páginas e componentes devem usar este hook para acesso consistente
 * Sincronização em tempo real via subscriptions
 */

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeBudgetLine(line) {
  const valorTotal = toNumber(line?.valor_total || line?.valor_rubrica || line?.saldo_inicial);
  const utilizado = toNumber(line?.valor_utilizado);
  const saldoDisponivel = toNumber(line?.saldo ?? line?.saldo_real ?? (valorTotal - utilizado));

  return {
    ...line,
    id: line?.id,
    codigo: line?.codigo || '',
    nome: line?.rubrica || line?.nome || line?.item_rubrica || line?.descricao || 'Rubrica',
    descricao: line?.rubrica || line?.nome || line?.item_rubrica || line?.descricao || 'Rubrica',
    rubrica_id: line?.id || line?.rubrica_id || '',
    budgetline_id: line?.id || line?.budgetline_id || '',
    budget_line_id: line?.id || line?.budget_line_id || '',
    centro_custo: line?.centro_custo || line?.museu_codigo || '',
    museu_codigo: line?.museu_codigo || '',
    meta: line?.meta || '',
    escopo_orcamentario: line?.escopo_orcamentario || '',
    saldo_inicial: valorTotal,
    saldo_comprometido: 0,
    saldo_disponivel: saldoDisponivel,
    valor_total_previsto: valorTotal,
  };
}

export function useBudgetLines() {
  const queryClient = useQueryClient();

  const invalidateBudgetQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['budget-lines'] }),
      queryClient.invalidateQueries({ queryKey: ['budget-lines-sync'] }),
      queryClient.invalidateQueries({ queryKey: ['budget'] }),
      queryClient.invalidateQueries({ queryKey: ['rubricas'] }),
      queryClient.invalidateQueries({ queryKey: ['rubricas-consolidadas'] }),
      queryClient.invalidateQueries({ queryKey: ['purchase-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['purchases'] }),
      queryClient.invalidateQueries({ queryKey: ['team-members'] }),
      queryClient.invalidateQueries({ queryKey: ['team-payments'] }),
      queryClient.invalidateQueries({ queryKey: ['team-payments-pending'] }),
      queryClient.invalidateQueries({ queryKey: ['team-payments-pending-review'] }),
    ]);
  };

  const { data: budgetLines = [], isLoading, error } = useQuery({
    queryKey: ['budget-lines'],
    queryFn: async () => {
      const allLines = await base44.entities.Rubrica.list('ordem_exibicao', 5000);

      return (allLines || [])
        .filter((line) => line?.ativo !== false)
        .map(normalizeBudgetLine)
        .sort((a, b) => (toNumber(a.ordem_exibicao) - toNumber(b.ordem_exibicao)) || String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR'));
    },
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    const unsubscribe = base44.entities.Rubrica.subscribe(async () => {
      await invalidateBudgetQueries();
    });

    return unsubscribe;
  }, [queryClient]);

  const budgetLineMap = useMemo(() => {
    const map = {};
    for (const line of budgetLines) {
      if (line?.id) map[line.id] = line;
      if (line?.budgetline_id) map[line.budgetline_id] = line;
      if (line?.budget_line_id) map[line.budget_line_id] = line;
    }
    return map;
  }, [budgetLines]);

  const rubricaMap = useMemo(() => {
    const map = {};
    for (const line of budgetLines) {
      if (line?.rubrica_id) {
        if (!map[line.rubrica_id]) map[line.rubrica_id] = [];
        map[line.rubrica_id].push(line);
      }
    }
    return map;
  }, [budgetLines]);

  const totalInicial = useMemo(
    () => budgetLines.reduce((acc, line) => acc + toNumber(line.saldo_inicial), 0),
    [budgetLines]
  );

  const totalComprometido = useMemo(
    () => budgetLines.reduce((acc, line) => acc + toNumber(line.saldo_comprometido), 0),
    [budgetLines]
  );

  const totalDisponivel = totalInicial - totalComprometido;

  return {
    budgetLines,
    isLoading,
    error,
    refreshBudgetLines: invalidateBudgetQueries,

    totalInicial,
    totalComprometido,
    totalDisponivel,

    getBudgetLine: (id) => budgetLineMap[id] || null,
    getBudgetLineByCode: (code) =>
      budgetLines.find((line) => String(line.codigo || '') === String(code || '')) || null,

    getBudgetLineByAnyId: (objOrId) => {
      if (!objOrId) return null;

      if (typeof objOrId === 'string') {
        return budgetLineMap[objOrId] || null;
      }

      const id =
        objOrId?.budgetline_id ||
        objOrId?.budget_line_id ||
        objOrId?.linha_orcamentaria_id ||
        objOrId?.id ||
        '';

      return budgetLineMap[id] || null;
    },

    getBudgetLinesByRubricaId: (rubricaId) => rubricaMap[rubricaId] || [],

    hasSaldoSuficiente: (budgetlineId, valor) => {
      const line = budgetLineMap[budgetlineId];
      if (!line) return false;
      return toNumber(line.saldo_disponivel) >= toNumber(valor);
    },
  };
}