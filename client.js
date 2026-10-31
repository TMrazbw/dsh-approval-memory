/**
 * dsh-approval-memory (DAM) — Client half.
 *
 * - `main` panel (key: `approval-memory`) + `sidebar.panellist`
 * - `/dam-ui` client command action
 * - `open_dam_ui` tool view that opens the panel when the agent calls it
 *
 * The page reads/writes the authenticated Host routes from `lib/bridge.js`;
 * it never imports another Harness Client package.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-approval-memory',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useEffect, useMemo, useState } = React;

    let activeLayout = null;
    let translate = (zh) => zh;

    const PANEL_ID = 'approval-memory';
    const SNAPSHOT_URL = 'api/approval-memory.snapshot';
    const MUTATE_URL = 'api/approval-memory.mutate';
    const RISK_LEVELS = ['low', 'medium', 'high', 'unknown'];
    const OPERATION_LABELS = {
      read: ['读取', 'Read'],
      write: ['写入', 'Write'],
      delete: ['删除', 'Delete'],
      execute: ['执行', 'Execute'],
      network: ['网络', 'Network'],
      install: ['安装', 'Install'],
      config: ['配置变更', 'Config'],
      permission: ['权限/安全', 'Permission'],
      'sandbox-escalation': ['沙箱升级', 'Sandbox escalation'],
      unknown: ['未知', 'Unknown'],
    };
    const RISK_LABELS = {
      low: ['低', 'Low'],
      medium: ['中', 'Medium'],
      high: ['高', 'High'],
      unknown: ['未知', 'Unknown'],
    };

    function t(zh, en) {
      return translate(zh, en);
    }

    function setTranslator(ctx) {
      try {
        const id = String(ctx.locale?.getLocale?.().id ?? '').toLowerCase();
        if (id.startsWith('en')) translate = (_zh, en) => en;
        else if (id.startsWith('zh')) translate = (zh) => zh;
      } catch {
        translate = (zh) => zh;
      }
    }

    function openPanel() {
      try {
        if (activeLayout === null) return false;
        activeLayout.selectPanel(PANEL_ID);
        return true;
      } catch {
        return false;
      }
    }

    function closePanel() {
      try {
        if (activeLayout === null) return false;
        activeLayout.selectPanel(null);
        return true;
      } catch {
        return false;
      }
    }

    function PanelIcon() {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: 18,
        height: 18,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', { d: 'M12 3l7 2.5v6.2c0 4.6-3 8-7 9.8-4-1.8-7-5.2-7-9.8V5.5L12 3z' }),
      h('path', { d: 'M8.5 9h5M8.5 12h5M8.5 15h2.5' }),
      h('path', { d: 'M14 15.2l1.8 1.8 3-3.6' }));
    }

    function OpenDamToolView(props) {
      const phase = props?.phase;
      const live = phase === 'preparing' || phase === 'start';
      const [autoOpened, setAutoOpened] = useState(false);
      const [status, setStatus] = useState('idle');

      useEffect(() => {
        if (!live || autoOpened) return;
        // A settled historical call must never navigate the UI: replaying the
        // conversation would otherwise steal the main panel every time.
        const opened = openPanel();
        setAutoOpened(true);
        setStatus(opened ? 'opened' : 'failed');
      }, [live, autoOpened]);

      function openManually() {
        setStatus(openPanel() ? 'opened' : 'failed');
      }

      const failed = status === 'failed';
      const opened = status === 'opened';
      const text = failed
        ? t('DAM 面板不可用，请用 /dam-ui', 'DAM panel unavailable; use /dam-ui')
        : opened
          ? t('DAM 面板已打开', 'DAM panel opened')
          : live
            ? t('正在打开 DAM 面板…', 'Opening the DAM panel…')
            : t('历史工具记录不会自动打开面板', 'Historical tool calls do not auto-open the panel');

      return h('div', {
        role: 'status',
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
          padding: '2px 0',
          fontSize: '12px',
          color: failed ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
        },
      },
      h('span', null, text),
      !opened && !failed && !live
        ? h('button', {
          type: 'button',
          onClick: openManually,
          style: { ...styles.button, padding: '2px 8px', fontSize: '11px' },
        }, t('打开 DAM 面板', 'Open DAM panel'))
        : null);
    }

    async function fetchSnapshot() {
      const response = await fetch(SNAPSHOT_URL, {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || `HTTP ${response.status}`);
      }
      return body;
    }

    async function mutate(payload) {
      const response = await fetch(MUTATE_URL, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message || `HTTP ${response.status}`);
      }
      return body;
    }

    function errorText(error) {
      return error instanceof Error ? error.message : String(error);
    }

    function operationLabel(operation) {
      const pair = OPERATION_LABELS[operation] || OPERATION_LABELS.unknown;
      return t(pair[0], pair[1]);
    }

    function riskLabel(level) {
      const pair = RISK_LABELS[level] || RISK_LABELS.unknown;
      return t(pair[0], pair[1]);
    }

    function riskColor(level) {
      if (level === 'low') return 'var(--dsw-alias-label-secondary)';
      if (level === 'medium') return 'var(--dsw-alias-state-warn-primary)';
      if (level === 'high') return 'var(--dsw-alias-state-error-primary)';
      return 'var(--dsw-alias-label-secondary)';
    }

    function classTitle(cls) {
      return t(cls.titleZh || cls.key, cls.titleEn || cls.key);
    }

    function riskReason(cls) {
      return t(cls.risk?.reasonZh || '', cls.risk?.reasonEn || '');
    }

    function formatCounts(counts = {}) {
      const total = Number(counts.total) || 0;
      const parts = [];
      if (counts.allowed > 0) parts.push(`${t('允许', 'allowed')} ${counts.allowed}`);
      if (counts.rejected > 0) parts.push(`${t('拒绝', 'rejected')} ${counts.rejected}`);
      if (counts.auto > 0) parts.push(`${t('自动', 'auto')} ${counts.auto}`);
      if (counts.cancelledOrUnavailable > 0) parts.push(`${t('取消', 'cancelled')} ${counts.cancelledOrUnavailable}`);
      return `${total}${t(' 次', '')}${parts.length === 0 ? '' : ` (${parts.join(' / ')})`}`;
    }

    function formatRelative(ms) {
      const value = Number(ms);
      if (!Number.isFinite(value)) return '';
      const diff = Date.now() - value;
      if (diff < 60_000) return t('刚刚', 'just now');
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}${t(' 分钟前', ' min ago')}`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}${t(' 小时前', ' h ago')}`;
      if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}${t(' 天前', ' d ago')}`;
      return new Date(value).toLocaleString();
    }

    function formatTime(ms) {
      const value = Number(ms);
      return Number.isFinite(value) ? new Date(value).toLocaleString() : '';
    }

    function shortId(id) {
      if (id === null || id === undefined) return '';
      const text = String(id);
      return text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-4)}` : text;
    }

    function Panel() {
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [notice, setNotice] = useState(null);
      const [pending, setPending] = useState(null);
      const [search, setSearch] = useState('');
      const [risk, setRisk] = useState('all');
      const [operation, setOperation] = useState('all');
      const [onlyRepeated, setOnlyRepeated] = useState(false);
      const [riskTagFilter, setRiskTagFilter] = useState('all');
      const [onlyTagged, setOnlyTagged] = useState(false);

      async function load(options = {}) {
        const silent = options.silent === true;
        if (!silent) setLoading(true);
        try {
          setSnapshot(await fetchSnapshot());
          setError(null);
        } catch (cause) {
          if (!silent) setError(errorText(cause));
        } finally {
          if (!silent) setLoading(false);
        }
      }

      useEffect(() => {
        // Load once when the panel opens; keep manual Refresh for later updates.
        // Collection and auto-approval decisions remain real-time on the Host.
        void load();
      }, []);

      const classes = snapshot?.classes ?? [];
      const rulesByKey = useMemo(() => {
        const map = new Map();
        for (const rule of snapshot?.rules ?? []) map.set(rule.classKey, rule);
        return map;
      }, [snapshot]);
      const blacklistKeys = useMemo(
        () => new Set((snapshot?.blacklist ?? []).map((row) => row.key)),
        [snapshot],
      );
      const activeRules = (snapshot?.rules ?? []).filter((rule) => rule.enabled === true).length;
      const refusedCount = (snapshot?.recentEvents ?? [])
        .filter((event) => event.type === 'rule-refused').length;
      const autoEvents = (snapshot?.recentEvents ?? [])
        .filter((event) => event.type === 'decided' && event.auto === true)
        .slice(-10)
        .reverse();

      function canToggle(cls) {
        return cls.risk?.level === 'low' && !blacklistKeys.has(cls.key);
      }

      const toggleableClasses = classes.filter((cls) => canToggle(cls));
      const statsOnlyCount = classes.length - toggleableClasses.length;
      const operations = [...new Set(toggleableClasses.map((cls) => cls.operation))]
        .filter((value) => typeof value === 'string')
        .sort();

      const visible = toggleableClasses.filter((cls) => {
        const title = `${cls.titleZh || ''} ${cls.titleEn || ''} ${cls.key}`.toLowerCase();
        if (search.trim().length > 0 && !title.includes(search.trim().toLowerCase())) return false;
        if (risk !== 'all' && cls.risk?.level !== risk) return false;
        if (operation !== 'all' && cls.operation !== operation) return false;
        if (onlyRepeated && (Number(cls.counts?.total) || 0) < 2) return false;
        return true;
      });

      const riskClasses = classes.filter((cls) => !canToggle(cls) && !blacklistKeys.has(cls.key));
      const classByKey = new Map(classes.map((cls) => [cls.key, cls]));
      const blacklistedClasses = classes.filter((cls) => blacklistKeys.has(cls.key));
      const blacklistedRequests = blacklistedClasses.reduce(
        (sum, cls) => sum + (Number(cls.counts?.total) || 0),
        0,
      );
      const riskTagOptions = [...new Set(riskClasses.flatMap((cls) => Object.keys(cls.riskTags ?? {})))]
        .sort();
      const visibleRisk = riskClasses.filter((cls) => {
        const tags = Object.keys(cls.riskTags ?? {});
        if (riskTagFilter !== 'all' && !tags.includes(riskTagFilter)) return false;
        if (onlyTagged && tags.length === 0) return false;
        return true;
      });
      const latestAskedByClass = new Map();
      for (const event of snapshot?.recentEvents ?? []) {
        if (event.type === 'asked' && typeof event.classKey === 'string') {
          latestAskedByClass.set(event.classKey, event);
        }
      }
      const highRiskRequests = riskClasses.reduce((sum, cls) => (
        cls.riskLevelHint === 'high' ? sum + (Number(cls.counts?.total) || 0) : sum
      ), 0);
      const autoSuccess = classes.reduce((sum, cls) => sum + (Number(cls.autoResults?.success) || 0), 0);
      const autoError = classes.reduce((sum, cls) => sum + (Number(cls.autoResults?.error) || 0), 0);
      const autoTotal = Number(snapshot?.totals?.auto) || 0;
      const autoNoResult = Math.max(0, autoTotal - autoSuccess - autoError);

      function enabled(cls) {
        const rule = rulesByKey.get(cls.key);
        if (rule !== undefined) return rule.enabled === true;
        return cls.risk?.level === 'low' && !blacklistKeys.has(cls.key);
      }

      function disabledReason(cls) {
        if (blacklistKeys.has(cls.key)) return t('黑名单：永远不能自动开启', 'Blacklisted: never auto-approved');
        if (cls.risk?.level === 'medium') return t('中风险：V1 仅展示，不开放自动同意', 'Medium risk: display only in V1');
        if (cls.risk?.level === 'high') return t('高风险：仅统计，不开放自动同意', 'High risk: statistics only, no auto-approval');
        return t('未知风险：仅统计', 'Unknown risk: statistics only');
      }

      async function toggle(cls, next) {
        if (!canToggle(cls)) return;
        setPending(cls.key);
        setNotice(null);
        try {
          const result = await mutate({ action: 'setRule', classKey: cls.key, enabled: next });
          if (result?.ok !== true) {
            setNotice(result?.messageZh || result?.messageEn || t('规则被拒绝', 'Rule was refused'));
          }
          await load();
        } catch (cause) {
          setNotice(errorText(cause));
        } finally {
          setPending(null);
        }
      }

      async function closeAll() {
        setPending('__all__');
        setNotice(null);
        try {
          const result = await mutate({ action: 'closeAll' });
          if (result?.ok !== true) {
            setNotice(result?.messageZh || result?.messageEn || t('关闭失败', 'Close-all failed'));
          }
          await load();
        } catch (cause) {
          setNotice(errorText(cause));
        } finally {
          setPending(null);
        }
      }

      function goBack() {
        if (!closePanel()) {
          setNotice(t('无法返回对话，请点击侧栏的对话入口', 'Could not return to the conversation; use the sidebar conversation entry'));
        }
      }

      function switchFor(cls) {
        const allowed = canToggle(cls);
        const checked = enabled(cls);
        return h('input', {
          type: 'checkbox',
          role: 'switch',
          checked,
          disabled: !allowed || pending !== null,
          'aria-label': `${classTitle(cls)} ${t('自动同意', 'auto-approve')}`,
          title: allowed ? t('自动同意此类请求', 'Auto-approve this class') : disabledReason(cls),
          onChange: (event) => void toggle(cls, event.target.checked),
          style: { width: '16px', height: '16px', cursor: allowed ? 'pointer' : 'not-allowed' },
        });
      }

      function rejectionText(cls) {
        const rejection = cls?.rejection;
        if (rejection === null || typeof rejection !== 'object') return null;
        const count = Number(rejection.count);
        if (!Number.isFinite(count) || count <= 0) return null;
        return t(
          `保留审计中曾被拒绝 ${count} 次，最近 ${formatTime(rejection.lastRejectedAt)}`,
          `Rejected ${count} time(s) in retained audit; latest ${formatTime(rejection.lastRejectedAt)}`,
        );
      }

      function riskRow(cls) {
        const tags = Object.entries(cls.riskTags ?? {})
          .filter(([tag]) => typeof tag === 'string' && tag.length > 0)
          .slice(0, 8);
        const latest = latestAskedByClass.get(cls.key);
        const command = (cls.commandExamples ?? [])[0]
          ?? (typeof latest?.commandPreview === 'string' ? latest.commandPreview : null);
        const cwd = typeof latest?.commandCwd === 'string' ? latest.commandCwd : null;
        const targets = Array.isArray(latest?.commandTargets) ? latest.commandTargets : [];

        return h('div', { key: cls.key, style: styles.riskRow },
          h('div', { style: styles.riskRowHead },
            h('div', null,
              h('div', { style: styles.cellTitle }, classTitle(cls)),
              h('div', { style: styles.cellMeta }, cls.key)),
            h('div', { style: styles.cellMeta },
              h('span', { style: { color: riskColor(cls.riskLevelHint), fontWeight: 500 } },
                riskLabel(cls.riskLevelHint)),
              ` · ${formatCounts(cls.counts)}`)),
          tags.length > 0
            ? h('div', { style: styles.riskTags }, ...tags.map(([tag, count]) => h('span', {
              key: `${cls.key}:${tag}`,
              style: styles.riskTag,
            }, `${tag} ×${count}`)))
            : h('div', { style: styles.cellMeta }, t('暂无风险标签', 'No risk tags')),
          command !== null
            ? h('pre', { style: styles.riskCommand }, command)
            : h('div', { style: styles.cellMeta }, t(
              '未获取到命令（callId 缺失或参数不可读）',
              'No command available (missing callId or unreadable arguments)',
            )),
          cwd !== null ? h('div', { style: styles.cellMeta }, `${t('目录：', 'Cwd: ')}${cwd}`) : null,
          targets.length > 0
            ? h('div', { style: styles.cellMeta }, `${t('命中目标：', 'Targets: ')}${targets.join(', ')}`)
            : null,
          rejectionText(cls) ? h('div', { style: styles.rejection }, rejectionText(cls)) : null,
          h('div', { style: styles.cellMeta }, t(
            '静态模式匹配，不是安全保证；不参与自动同意判定。',
            'Static pattern match, not a guarantee; never part of the approval decision.',
          )));
      }

      return h('div', { style: styles.page },
        h('header', { style: styles.header },
          h('div', null,
            h('h1', { style: styles.title }, t('自动同意请求', 'Auto-approve requests')),
            h('p', { style: styles.subtitle }, t(
              '按请求类统计审批；低风险只读类默认自动同意，其他类仅统计。风险为静态推断，不是安全保证。',
              'Approval classes with counts; low-risk read-only classes are auto-approved by default. Risk is a static inference, not a guarantee.',
            ))),
          h('div', { style: styles.actions },
            h('button', {
              type: 'button',
              style: styles.button,
              onClick: goBack,
              title: t('返回当前对话（关闭此面板）', 'Return to the current conversation (close this panel)'),
            }, t('返回对话', 'Back to conversation')),
            h('button', { type: 'button', style: styles.button, onClick: () => void load(), disabled: loading },
              loading ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh')),
            h('button', {
              type: 'button',
              style: { ...styles.button, color: 'var(--dsw-alias-state-warn-primary)' },
              onClick: () => void closeAll(),
              disabled: pending !== null,
              title: t('关闭所有已开启的自动同意规则；不关闭此面板', 'Disable every enabled auto-approve rule; does not close this panel'),
            }, pending === '__all__' ? t('关闭中…', 'Closing…') : t('关闭全部自动同意', 'Disable all auto-approve')))),
        notice !== null ? h('div', { role: 'alert', style: styles.notice }, notice) : null,
        error !== null ? h('div', { role: 'alert', style: styles.error }, error) : null,
        snapshot === null && loading ? h('p', { style: styles.muted }, t('加载中…', 'Loading…')) : null,
        snapshot !== null ? h('div', null,
          snapshot.degraded ? h('div', { role: 'status', style: styles.warn }, t(
            '存储处于降级状态；部分写入可能未持久化。',
            'Storage is degraded; some writes may not be persisted.',
          )) : null,
          h('div', { style: styles.grid },
            card(t('请求总数', 'Requests'), String(snapshot.totals?.requests ?? 0)),
            card(t('自动同意', 'Auto-approved'), String(snapshot.totals?.auto ?? 0)),
            card(t('可同意请求类', 'Toggleable classes'), String(toggleableClasses.length)),
            card(t('生效规则', 'Active rules'), String(activeRules)),
            card(t('黑名单请求', 'Blacklisted requests'), String(blacklistedRequests))),
          highRiskRequests > 0 ? h('p', { style: styles.muted }, t(
            `含高危模式的请求 ${highRiskRequests} 次（仅统计，不参与自动同意）。`,
            `${highRiskRequests} request(s) with high-risk patterns (statistics only, never auto-approved).`,
          )) : null,
          snapshot.classes.length === 0 ? h('div', { style: styles.empty }, t(
            '还没有审批记录。出现审批请求后，这里会自动新增请求类。',
            'No approvals recorded yet. Request classes appear here as they occur.',
          )) : h('div', null,
            statsOnlyCount > 0 ? h('p', { style: styles.muted }, t(
              `另有 ${statsOnlyCount} 个已出现类不可自动同意，仅计入总数，不在本表显示。`,
              `${statsOnlyCount} observed class(es) cannot be auto-approved; they are counted but not listed here.`,
            )) : null,
            h('div', { style: styles.filters },
              h('input', {
                type: 'search',
                value: search,
                placeholder: t('搜索请求类…', 'Search request classes…'),
                'aria-label': t('搜索请求类', 'Search request classes'),
                onChange: (event) => setSearch(event.target.value),
                style: styles.input,
              }),
              h('select', {
                value: risk,
                'aria-label': t('风险筛选', 'Risk filter'),
                onChange: (event) => setRisk(event.target.value),
                style: styles.select,
              },
              h('option', { value: 'all' }, t('全部风险', 'All risks')),
              ...RISK_LEVELS.map((level) => h('option', { key: level, value: level }, riskLabel(level)))),
              h('select', {
                value: operation,
                'aria-label': t('操作筛选', 'Operation filter'),
                onChange: (event) => setOperation(event.target.value),
                style: styles.select,
              },
              h('option', { value: 'all' }, t('全部操作', 'All operations')),
              ...operations.map((value) => h('option', { key: value, value }, operationLabel(value)))),
              h('label', { style: styles.checkLabel },
                h('input', {
                  type: 'checkbox',
                  checked: onlyRepeated,
                  onChange: (event) => setOnlyRepeated(event.target.checked),
                }),
                t('只看重复', 'Repeated only'))),
            h('div', { style: styles.tableScroll },
              h('table', { style: styles.table },
                h('thead', null, h('tr', null,
                  ...[t('可同意请求类', 'Toggleable class'), t('操作', 'Operation'), t('实际次数', 'Actual count'),
                    t('风险', 'Risk'), t('自动同意', 'Auto-approve'), t('最近出现', 'Last seen')]
                    .map((label) => h('th', { key: label, style: styles.th }, label)))),
                h('tbody', null, ...visible.map((cls) => h('tr', { key: cls.key },
                  h('td', { style: styles.td },
                    h('div', { style: styles.cellTitle }, classTitle(cls)),
                    h('div', { style: styles.cellMeta }, cls.key),
                    riskReason(cls) ? h('div', { style: styles.cellMeta }, riskReason(cls)) : null,
                    (cls.examples ?? []).slice(0, 1).map((example) => h('div', {
                      key: `${cls.key}:example`,
                      style: styles.cellMeta,
                    }, example)),
                    rejectionText(cls) ? h('div', { style: styles.rejection }, rejectionText(cls)) : null),
                  h('td', { style: styles.td }, operationLabel(cls.operation)),
                  h('td', { style: styles.td }, formatCounts(cls.counts)),
                  h('td', { style: styles.td },
                    h('span', { style: { color: riskColor(cls.risk?.level), fontWeight: 500 } },
                      riskLabel(cls.risk?.level)),
                    blacklistKeys.has(cls.key) ? h('div', { style: styles.cellMeta }, t('黑名单', 'Blacklisted')) : null),
                  h('td', { style: styles.td }, switchFor(cls)),
                  h('td', { style: styles.td }, formatRelative(cls.lastSeenAt)))))),
            visible.length === 0 ? h('p', { style: styles.muted }, t('没有匹配的可自动同意请求类。', 'No matching toggleable request classes.')) : null)),
          h('details', { style: styles.riskSection },
            h('summary', { style: styles.riskSummary },
              h('span', null,
                t('不可自动同意（仅统计）', 'No auto-approval (statistics only)'),
                h('span', { style: styles.riskBadge }, t(`其他 ${riskClasses.length}`, `other ${riskClasses.length}`)),
                blacklistedClasses.length > 0
                  ? h('span', { style: styles.riskBadge }, t(`黑名单 ${blacklistedRequests} 次`, `blacklist ${blacklistedRequests} requests`))
                  : null,
                highRiskRequests > 0
                  ? h('span', { style: styles.riskBadge }, t(`高危 ${highRiskRequests} 次`, `${highRiskRequests} high-risk`))
                  : null),
              h('span', { style: styles.muted }, t('展开查看', 'Expand'))),
            h('div', { style: styles.riskBody },
              h('p', { style: styles.muted }, t(
                '这些请求类都不会自动同意；风险标签只用于展示，不参与自动同意判定。'
                + ' 黑名单是永久拒绝，既不能创建规则，也不能手动开启自动同意。',
                'None of these classes can be auto-approved; risk tags are display-only and never affect the decision.'
                + ' Blacklist entries are permanent: no rule can be created and they can never be switched on.',
              )),
              h('h3', { style: styles.riskGroupTitle },
                t('其他不可自动同意', 'Other non-auto-approvable classes')),
              riskClasses.length > 0 ? h('div', null,
                h('div', { style: styles.riskFilters },
                  h('select', {
                    value: riskTagFilter,
                    'aria-label': t('风险标签筛选', 'Risk tag filter'),
                    onChange: (event) => setRiskTagFilter(event.target.value),
                    style: styles.select,
                  },
                  h('option', { value: 'all' }, t('全部风险标签', 'All risk tags')),
                  ...riskTagOptions.map((tag) => h('option', { key: tag, value: tag }, tag))),
                  h('label', { style: styles.checkLabel },
                    h('input', {
                      type: 'checkbox',
                      checked: onlyTagged,
                      onChange: (event) => setOnlyTagged(event.target.checked),
                    }),
                    t('只看有标签', 'Tagged only'))),
                ...visibleRisk.map(riskRow),
                visibleRisk.length === 0
                  ? h('p', { style: styles.muted }, t('没有匹配的风险类。', 'No matching risk classes.'))
                  : null)
                : h('p', { style: styles.muted }, t('没有其他不可自动同意请求。', 'No other non-auto-approvable requests.')),
              h('h3', { style: styles.riskGroupTitle },
                t('永久黑名单（只读）', 'Permanent blacklist (read-only)'),
                refusedCount > 0 ? h('span', { style: styles.sectionBadge }, t(`拦截 ${refusedCount} 次`, `${refusedCount} refused`)) : null),
              h('p', { style: styles.muted }, t(
                '出现次数为所有会话的只读统计，不进入主表或“其他不可自动同意”区。',
                'Counts are read-only across sessions and stay out of the main table and the other-class group.',
              )),
              ...(snapshot.blacklist ?? []).map((row) => {
                const cls = classByKey.get(row.key);
                return h('div', { key: row.key, style: styles.blacklistRow },
                  h('div', { style: styles.blacklistHead },
                    h('code', { style: styles.code }, row.key),
                    h('span', { style: cls === undefined ? styles.cellMeta : styles.rejection },
                      cls === undefined
                        ? t('暂无记录', 'No records')
                        : t(`出现 ${Number(cls.counts?.total) || 0} 次`, `${Number(cls.counts?.total) || 0} request(s)`))),
                  h('span', { style: styles.cellMeta }, t(row.reasonZh, row.reasonEn)),
                  cls !== undefined
                    ? h('span', { style: styles.cellMeta }, formatCounts(cls.counts))
                    : null);
              }))),
          h('section', { style: styles.section },
            h('h2', { style: styles.sectionTitle }, t('自动同意记录', 'Auto-approval log')),
            autoTotal > 0 ? h('p', { style: styles.muted }, t(
              `自动同意结果（近似）：成功 ${autoSuccess} / 失败 ${autoError} / 未执行 ${autoNoResult}`,
              `Auto-approval results (approximate): ok ${autoSuccess} / error ${autoError} / no-result ${autoNoResult}`,
            )) : null,
            autoEvents.length === 0
              ? h('p', { style: styles.muted }, t('暂无自动同意。', 'No auto approvals yet.'))
              : autoEvents.map((event, index) => h('div', {
                key: `${event.time}-${event.classKey}-${index}`,
                style: styles.auditRow,
              },
              h('span', null, formatTime(event.time)),
              h('code', { style: styles.code }, event.classKey),
              h('span', { style: styles.cellMeta }, shortId(event.sessionId))))),
          h('footer', { style: styles.footer },
            snapshot.dataRoot ? `${t('数据目录：', 'Data root: ')}${snapshot.dataRoot}` : '',
            snapshot.generatedAt ? ` · ${t('快照：', 'Snapshot: ')}${formatTime(Date.parse(snapshot.generatedAt))}` : ''))
          : null);
    }

    function card(label, value) {
      return h('div', { style: styles.card },
        h('div', { style: styles.cardLabel }, label),
        h('div', { style: styles.cardValue }, value));
    }

    const styles = {
      page: {
        padding: '20px 24px',
        maxWidth: '1180px',
        margin: '0 auto',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'inherit',
        height: '100%',
        maxHeight: '100%',
        overflowY: 'auto',
        boxSizing: 'border-box',
      },
      header: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '12px',
        marginBottom: '16px',
      },
      title: { margin: 0, fontSize: '18px', fontWeight: 600 },
      subtitle: { margin: '4px 0 0', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', maxWidth: '760px' },
      actions: { display: 'flex', gap: '8px', flexShrink: 0 },
      button: {
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        borderRadius: '8px',
        padding: '6px 10px',
        cursor: 'pointer',
        fontSize: '12px',
      },
      notice: {
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-state-warn-primary)',
        borderRadius: '8px',
        padding: '8px 10px',
        fontSize: '12px',
        marginBottom: '12px',
      },
      error: {
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-state-error-primary)',
        borderRadius: '8px',
        padding: '8px 10px',
        fontSize: '12px',
        marginBottom: '12px',
      },
      warn: {
        border: '1px solid var(--dsw-alias-state-warn-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-state-warn-primary)',
        borderRadius: '8px',
        padding: '8px 10px',
        fontSize: '12px',
        marginBottom: '12px',
      },
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: '10px',
        marginBottom: '16px',
      },
      card: {
        background: 'var(--dsw-alias-bg-layer-1)',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        padding: '12px 14px',
      },
      cardLabel: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' },
      cardValue: { fontSize: '18px', fontWeight: 600 },
      empty: {
        border: '1px dashed var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        padding: '28px',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '13px',
        textAlign: 'center',
        marginBottom: '16px',
      },
      filters: { display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '10px' },
      input: {
        minWidth: '180px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        padding: '6px 8px',
        fontSize: '12px',
      },
      select: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        padding: '6px 8px',
        fontSize: '12px',
      },
      checkLabel: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '12px' },
      tableScroll: {
        overflowX: 'auto',
        overflowY: 'auto',
        maxHeight: 'calc(100vh - 360px)',
        minHeight: '120px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        overscrollBehavior: 'contain',
      },
      table: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' },
      th: {
        textAlign: 'left',
        padding: '7px 8px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontWeight: 500,
        whiteSpace: 'nowrap',
      },
      td: { padding: '8px', borderBottom: '1px solid var(--dsw-alias-border-l1)', verticalAlign: 'top' },
      cellTitle: { fontWeight: 500 },
      cellMeta: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px', lineHeight: 1.5, wordBreak: 'break-all' },
      code: {
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-secondary)',
        wordBreak: 'break-all',
      },
      section: { marginTop: '18px' },
      riskSection: {
        marginTop: '16px',
        padding: '0 12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-1)',
      },
      riskSummary: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        padding: '10px 0',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: 600,
      },
      riskBadge: {
        marginLeft: '8px',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '11px',
        fontWeight: 500,
      },
      riskBody: { padding: '0 0 10px' },
      riskGroupTitle: {
        margin: '12px 0 6px',
        fontSize: '12px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-secondary)',
      },
      riskFilters: {
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '8px',
        marginBottom: '10px',
      },
      riskRow: {
        display: 'flex',
        flexDirection: 'column',
        gap: '5px',
        padding: '10px 0',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      riskRowHead: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '10px',
      },
      riskTags: { display: 'flex', flexWrap: 'wrap', gap: '4px' },
      riskTag: {
        padding: '1px 6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '999px',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '10px',
      },
      riskCommand: {
        margin: '0',
        padding: '6px 8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '6px',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: 'var(--ds-font-family-code)',
        fontSize: '11px',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      },
      rejection: {
        color: 'var(--dsw-alias-state-warn-primary)',
        fontSize: '11px',
        lineHeight: 1.5,
      },
      sectionTitle: { margin: '0 0 8px', fontSize: '14px', fontWeight: 600 },
      sectionBadge: {
        marginLeft: '8px',
        color: 'var(--dsw-alias-state-warn-primary)',
        fontSize: '11px',
        fontWeight: 400,
      },
      blacklistHead: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '8px',
        flexWrap: 'wrap',
      },
      blacklistRow: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '6px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
      auditRow: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'baseline', padding: '5px 0', borderBottom: '1px solid var(--dsw-alias-border-l1)', fontSize: '12px' },
      footer: { marginTop: '18px', color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
    };

    return {
      inject: ['slots', 'layout', 'locale', 'commandUi'],
      apply(ctx) {
        activeLayout = ctx.layout ?? null;
        setTranslator(ctx);

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, Panel));

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          label: () => t('自动同意请求', 'Auto-approve requests'),
        }, PanelIcon));

        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
          name: 'tool.call.toolview',
          key: 'open_dam_ui',
        }, OpenDamToolView));

        ctx.effect(() => ctx.commandUi.register({
          name: 'dam-ui',
          available: () => true,
          label: () => 'DAM-UI',
          description: () => t('打开自动同意请求面板', 'Open the DAM approval-memory panel'),
          icon: PanelIcon,
          ui: {
            kind: 'action',
            run: () => {
              openPanel();
            },
          },
        }));
      },
    };
  },
});
