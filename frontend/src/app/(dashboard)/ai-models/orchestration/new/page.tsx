'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import {
  orchestrationsApi, predictionEnginesApi, coinsApi, klinesApi,
  type OrchestrationMetric, type PredictionEngineParameterResponse,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toast } from 'sonner';

// Calibration universe: intervals and grain vocabulary (crypto domain).
const INTERVAL_OPTIONS = ['5m', '15m', '1h', '4h', '1d', '1w'] as const;

const TARGET_OPTIONS = [
  { value: 'pooled', labelKey: 'targetPooled' },
  { value: 'pair', labelKey: 'targetPair' },
] as const;

function InfoIcon({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0 mt-px" />
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}

// The value a parameter option applies (the `parameter` field, falling back to `value`).
function paramValue(o: PredictionEngineParameterResponse): string {
  return o.parameter ?? o.value;
}

/** Per-model parameter selectors. Fetches the engine's parameters, groups them
 * by name, and renders a dropdown per group. Seeds the parent state with each
 * group's default so the chosen params are always explicit and reproducible. */
function ModelParams({
  engineId,
  label,
  values,
  onChange,
}: {
  engineId: string;
  label: string;
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  const { data: params = [] } = useQuery({
    queryKey: ['engine-params', engineId],
    queryFn: () => predictionEnginesApi.listParameters(engineId),
    enabled: !!engineId,
    staleTime: 5 * 60 * 1000,
  });

  const groups = useMemo(() => {
    const m = new Map<string, PredictionEngineParameterResponse[]>();
    for (const p of params) {
      const arr = m.get(p.name) ?? [];
      arr.push(p);
      m.set(p.name, arr);
    }
    return Array.from(m.entries()).map(
      ([name, opts]) => [name, [...opts].sort((a, b) => a.sort_order - b.sort_order)] as const,
    );
  }, [params]);

  // Seed defaults (selected option, or first) into parent state once loaded.
  useEffect(() => {
    for (const [name, opts] of groups) {
      if (values[name] === undefined) {
        const def = opts.find((o) => o.selected) ?? opts[0];
        if (def) onChange(name, paramValue(def));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups]);

  if (groups.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-[var(--input)] p-2">
      <span className="text-sm font-medium">{label}</span>
      {groups.map(([name, opts]) => {
        const def = opts.find((o) => o.selected) ?? opts[0];
        const current = values[name] ?? (def ? paramValue(def) : '');
        return (
          <div key={name} className="grid grid-cols-[140px_1fr] items-center gap-3">
            <span className="text-xs text-[var(--muted-foreground)]">{name}</span>
            <select
              value={current}
              onChange={(e) => onChange(name, e.target.value)}
              className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
            >
              {opts.map((o) => (
                <option key={o.id} value={paramValue(o)}>
                  {o.value}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </div>
  );
}

// Draft persistence — keep the in-progress form across navigation.
const DRAFT_KEY = 'crypt:orchestration:new';

function loadDraft(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export default function CreateOrchestrationPage() {
  const t = useTranslations('orchestrationsNewPage');
  const router = useRouter();
  const queryClient = useQueryClient();

  // Restore any in-progress draft from localStorage (once, on mount).
  const saved = useMemo(() => loadDraft(), []);
  const [name, setName] = useState((saved?.name as string) ?? '');
  const [description, setDescription] = useState((saved?.description as string) ?? '');
  const [notes, setNotes] = useState((saved?.notes as string) ?? '');
  const [target, setTarget] = useState((saved?.target as string) ?? 'pooled');
  const [selectedModels, setSelectedModels] = useState<Set<string>>(
    () => new Set((saved?.selectedModels as string[]) ?? []),
  );
  const [metric, setMetric] = useState((saved?.metric as string) ?? 'mase');
  const [topN, setTopN] = useState((saved?.topN as string) ?? '4');
  // Calibration universe.
  const [quoteAsset, setQuoteAsset] = useState((saved?.quoteAsset as string) ?? 'USDT');
  const [interval, setInterval] = useState((saved?.interval as string) ?? '1h');
  const [coinIds, setCoinIds] = useState<Set<string>>(
    () => new Set((saved?.coinIds as string[]) ?? []),
  );
  // Per-model parameter overrides: { engine_slug: { param_name: value } }.
  const [engineParams, setEngineParams] = useState<Record<string, Record<string, string>>>(
    (saved?.engineParams as Record<string, Record<string, string>>) ?? {},
  );

  // Persist the whole form whenever anything changes.
  useEffect(() => {
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          name, description, notes, target,
          selectedModels: [...selectedModels], metric, topN,
          quoteAsset, interval, coinIds: [...coinIds], engineParams,
        }),
      );
    } catch {
      /* ignore quota / unavailable storage */
    }
  }, [name, description, notes, target, selectedModels, metric, topN, quoteAsset, interval, coinIds, engineParams]);

  const { data: engines = [] } = useQuery({
    queryKey: ['prediction-engines'],
    queryFn: () => predictionEnginesApi.list(),
    staleTime: 5 * 60 * 1000,
  });
  const availableModels = useMemo(
    () => engines.map((e) => ({ slug: e.slug, label: e.name })),
    [engines],
  );
  const engineIdBySlug = useMemo(
    () => Object.fromEntries(engines.map((e) => [e.slug, e.id])),
    [engines],
  );

  const { data: coins = [] } = useQuery({
    queryKey: ['coins'],
    queryFn: () => coinsApi.list({ limit: 1000 }),
    staleTime: 5 * 60 * 1000,
  });

  // Quote assets available for the selected coins — union of the trading pairs
  // loaded for each. Drives the Quote Asset dropdown below.
  const selectedCoinIdList = useMemo(() => [...coinIds], [coinIds]);
  const pairQueries = useQueries({
    queries: selectedCoinIdList.map((id) => ({
      queryKey: ['trading-pairs', id],
      queryFn: () => klinesApi.getTradingPairs(id),
      staleTime: 5 * 60 * 1000,
    })),
  });
  const pairsLoading = pairQueries.some((q) => q.isLoading);
  const quotesKey = pairQueries.map((q) => (q.data?.pairs ?? []).join(',')).join('|');
  const availableQuotes = useMemo(() => {
    const set = new Set<string>();
    for (const q of pairQueries) for (const p of q.data?.pairs ?? []) set.add(p);
    return [...set].sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotesKey]);
  // Options shown in the dropdown: the available quotes, plus the current value
  // so a restored draft's selection never silently disappears.
  const quoteOptions = useMemo(() => {
    const set = new Set(availableQuotes);
    if (quoteAsset) set.add(quoteAsset);
    return [...set].sort();
  }, [availableQuotes, quoteAsset]);
  // Keep the selection valid: if what's loaded doesn't include the current
  // quote asset, fall back to USDT (if present) or the first available.
  useEffect(() => {
    if (availableQuotes.length === 0) return;
    if (!availableQuotes.includes(quoteAsset)) {
      setQuoteAsset(availableQuotes.includes('USDT') ? 'USDT' : availableQuotes[0]);
    }
  }, [availableQuotes, quoteAsset]);

  const setParam = (slug: string, name: string, value: string) =>
    setEngineParams((prev) => ({ ...prev, [slug]: { ...(prev[slug] ?? {}), [name]: value } }));

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name is required');
      if (selectedModels.size < 2) throw new Error('Select at least 2 models');

      return orchestrationsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        notes: notes.trim() || undefined,
        engine_slugs: Array.from(selectedModels),
        metric: metric as OrchestrationMetric,
        top_n: parseInt(topN),
        prediction_target: target,
        quote_asset: quoteAsset.trim() || 'USDT',
        interval,
        coin_ids: Array.from(coinIds),
        // Per-model parameter choices for the selected models.
        engine_params: Object.fromEntries(
          Array.from(selectedModels)
            .filter((slug) => engineParams[slug] && Object.keys(engineParams[slug]).length > 0)
            .map((slug) => [slug, engineParams[slug]]),
        ),
      });
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['orchestration-groups'] });
      toast.success(t('successMessage'));
      handleClear();
      // Go back to the overview and pre-open the new group's detail pane
      // (the list page reads this localStorage key on mount).
      try {
        localStorage.setItem('crypt:orchestration:selectedGroup', JSON.stringify(created.id));
      } catch {
        /* ignore unavailable storage */
      }
      router.push('/ai-models/orchestration');
    },
    onError: () => {
      toast.error(t('errorMessage'));
    },
  });

  const handleModelToggle = (slug: string) => {
    const newSet = new Set(selectedModels);
    if (newSet.has(slug)) {
      newSet.delete(slug);
    } else {
      newSet.add(slug);
    }
    setSelectedModels(newSet);
  };

  const handleCoinToggle = (id: string) => {
    const newSet = new Set(coinIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setCoinIds(newSet);
  };

  const handleClear = () => {
    setName('');
    setDescription('');
    setNotes('');
    setTarget('pooled');
    setSelectedModels(new Set());
    setMetric('mase');
    setTopN('4');
    setQuoteAsset('USDT');
    setInterval('1h');
    setCoinIds(new Set());
    setEngineParams({});
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className="max-w-5xl px-6 py-6 flex flex-col gap-8">
        {/* ── Fields ─────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          {/* Name */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('name')} *
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              className="h-8 text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('description')}
            </label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('descriptionPlaceholder')}
              rows={2}
              className="resize-none text-sm"
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('notes')}
            </label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={t('notesPlaceholder')}
              rows={3}
              className="resize-none text-sm"
            />
          </div>

          {/* Calibration Grain */}
          <div className="flex flex-col gap-1.5 pt-2">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                {t('calibrationGrain')}
              </label>
              <InfoIcon text={t('calibrationGrainHelp')} />
            </div>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
            >
              {TARGET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey as Parameters<typeof t>[0])}
                </option>
              ))}
            </select>
          </div>

          {/* Coins — select first; drives which quote assets are available. */}
          <div className="flex flex-col gap-1.5 pt-2">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                {t('coins')}
              </label>
              <InfoIcon text={t('coinsHelp')} />
            </div>
            {coins.length === 0 ? (
              <p className="text-xs text-[var(--muted-foreground)]">{t('coinsNone')}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 mt-1 max-h-56 overflow-y-auto rounded-md border border-[var(--input)] p-2">
                {coins.map((c) => (
                  <div key={c.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`coin-${c.id}`}
                      checked={coinIds.has(c.id)}
                      onCheckedChange={() => handleCoinToggle(c.id)}
                    />
                    <label htmlFor={`coin-${c.id}`} className="text-sm cursor-pointer select-none">
                      {c.symbol}
                    </label>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">{t('coinsAllHint')}</p>
          </div>

          {/* Calibration Universe — quote asset (from the selected coins) + interval. */}
          <div className="flex flex-col gap-1.5 pt-2">
            <div className="flex items-center gap-1">
              <label className="text-xs font-medium text-[var(--muted-foreground)]">
                {t('calibrationUniverse')}
              </label>
              <InfoIcon text={t('calibrationUniverseHelp')} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">
                    {t('quoteAsset')}
                  </label>
                  <InfoIcon text={t('quoteAssetHelp')} />
                </div>
                <select
                  value={quoteAsset}
                  onChange={(e) => setQuoteAsset(e.target.value)}
                  disabled={coinIds.size === 0 || pairsLoading}
                  className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {coinIds.size === 0 ? (
                    <option value={quoteAsset}>{t('quoteAssetSelectCoins')}</option>
                  ) : (
                    quoteOptions.map((q) => (
                      <option key={q} value={q}>{q}</option>
                    ))
                  )}
                </select>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">
                    {t('interval')}
                  </label>
                  <InfoIcon text={t('intervalHelp')} />
                </div>
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
                >
                  {INTERVAL_OPTIONS.map((iv) => (
                    <option key={iv} value={iv}>{iv}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Model Selection */}
          <div className="flex flex-col gap-1.5 pt-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('selectModels')} *
            </label>
            <p className="text-xs text-[var(--muted-foreground)]">
              {t('selectModelsHelp')}
            </p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {availableModels.map((model) => (
                <div key={model.slug} className="flex items-center space-x-2">
                  <Checkbox
                    id={model.slug}
                    checked={selectedModels.has(model.slug)}
                    onCheckedChange={() => handleModelToggle(model.slug)}
                  />
                  <label
                    htmlFor={model.slug}
                    className="text-sm cursor-pointer select-none"
                  >
                    {model.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Per-model parameters */}
          {selectedModels.size > 0 && (
            <div className="flex flex-col gap-1.5 pt-2">
              <div className="flex items-center gap-1">
                <label className="text-xs font-medium text-[var(--muted-foreground)]">
                  {t('modelParameters')}
                </label>
                <InfoIcon text={t('modelParametersHelp')} />
              </div>
              <div className="flex flex-col gap-2 mt-1">
                {availableModels.filter((m) => selectedModels.has(m.slug)).map((model) => {
                  const engineId = engineIdBySlug[model.slug];
                  if (!engineId) return null;
                  return (
                    <ModelParams
                      key={model.slug}
                      engineId={engineId}
                      label={model.label}
                      values={engineParams[model.slug] ?? {}}
                      onChange={(name, value) => setParam(model.slug, name, value)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Configuration */}
          <div className="flex flex-col gap-1.5 pt-2">
            <label className="text-xs font-medium text-[var(--muted-foreground)]">
              {t('configuration')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">
                    {t('metric')}
                  </label>
                  <InfoIcon text={t('metricHelp')} />
                </div>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value)}
                  className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
                >
                  <option value="mase">MASE</option>
                  <option value="smase">Seasonal MASE</option>
                  <option value="crps">CRPS</option>
                  <option value="mae">MAE</option>
                  <option value="mape">MAPE</option>
                  <option value="rmse">RMSE</option>
                </select>
              </div>
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <label className="text-xs font-medium text-[var(--muted-foreground)]">
                    {t('topN')}
                  </label>
                  <InfoIcon text={t('topNHelp')} />
                </div>
                <select
                  value={topN}
                  onChange={(e) => setTopN(e.target.value)}
                  className="w-full h-8 px-2 border border-[var(--input)] rounded-md bg-[var(--background)] text-sm"
                >
                  {[2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

        </div>

        {/* ── Actions ────────────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={createMutation.isPending}
            className="cursor-pointer"
          >
            {t('clearButton')}
          </Button>
          <Button
            size="sm"
            onClick={() => createMutation.mutate()}
            disabled={
              createMutation.isPending ||
              !name.trim() ||
              selectedModels.size < 2
            }
            className="cursor-pointer"
          >
            {createMutation.isPending ? t('creating') : t('createButton')}
          </Button>
        </div>
      </div>
    </TooltipProvider>
  );
}
