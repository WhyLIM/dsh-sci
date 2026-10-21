/**
 * dsh-sci —— 客户端半边：DSH「设置 → 科研」。
 *
 * 数据流：本组件 ⇄ /dsh-sci/api/*（同源）⇄ ~/.dsh/sci.config.json。
 * 密钥只在 POST /secrets 时发一次；GET 永远只返回“有没有”。
 */
window.__ModuleLoader__.load({
  id: 'dsh-sci',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React
    const API = '/dsh-sci/api'

    const ZH = {
      nav: '科研',
      title: '科研',
      intro: '让 DSH 像生物医学博士生一样扫文献、读全文、写笔记。Europe PMC + PubMed 为主，含 PICO、研究类型与撤稿安全、表格/图、引文追踪与筛选导出。',
      save: '保存设置',
      unsavedTitle: '还有未保存的设置',
      unsavedBody: '关闭设置页前要保存吗？不保存的修改会丢失。',
      discardReload: '有未保存的修改，重新载入会丢失。继续？',
      saveAndClose: '保存并退出',
      discardClose: '不保存退出',
      cancel: '取消',
      saving: '保存中…',
      saved: '已保存',
      reload: '重新载入',
      deps: '依赖体检',
      runScan: '现在扫描一轮',
      runDeep: '现在深读一轮',
      runReview: '现在做周总结',
      running: '已排入会话…',
      status: '状态',
      brief: '最近简报',
      noBrief: '还没有简报。点「现在扫描一轮」或等下一次作息。',
      research: '研究方向',
      field: '研究方向',
      fieldHint: '一句话描述你在做什么，例如「用蛋白语言模型做酶设计」',
      species: '默认物种 / taxid',
      speciesHint: '如 human、mouse、9606；留空则不默认人类，数据库核对会提示歧义',
      keywords: '持续关注的关键词',
      keywordsHint: '逗号分隔；每次扫描取前 3 个，每个词各搜一轮',
      venues: '常看期刊/会议',
      venuesHint: '逗号分隔；题录里的期刊/会议名命中会加分',
      methods: '关心的方法/证据',
      methodsHint: '例如 benchmark、ablation、external validation',
      exclude: '排除词',
      excludeHint: '标题/摘要命中的会降权，例如 editorial、correction',
      execution: '执行位置',
      execHint: '指定作息到点后在哪个 DSH 工作区/会话里执行；默认是 dsh-sci + 数据目录。',
      execSession: '执行会话',
      execSessionHint: '自动列出所选工作区里的会话；也可以选择“新建会话”。',
      execWorkspace: '工作区（Workspace）',
      defaultWorkspace: '默认工作区',
      execWorkspaceHint: '与 DSH 左侧工作区列表一致；「不指定工作区」只是插件数据目录，不是 DSH 工作区。执行会话会从所选工作区自动检测。',
      refreshTargets: '刷新工作区/会话',
      newSession: '＋ 新建会话',
      noWorkspace: '不指定工作区（数据目录）',
      ungrouped: '未分组',
      pickFolder: '选择文件夹…',
      output: '输出目录',
      dataDirInternal: '数据目录（内部）',
      dataDirInternalHint: '题录/全文/PDF/图片/缓存固定在这里；不随输出目录移动。',
      outputDir: '自定义输出目录',
      outputDirHint: '留空 = ~/.dsh/sci。笔记/简报/周总结/检索策略会写到这个目录；文献库/缓存仍在数据目录。',
      outputResolved: '当前输出',
      topics: '研究课题',
      topicsHint: '从本地文件/文件夹或 GitHub 仓库引入；agent 会阅读材料并补全 PROJECT.md，搜索会自动加入课题关键词。',
      topicPath: '本地文件/文件夹路径',
      topicPathHint: '例如 ~/projects/my-lab 或 ~/papers/idea.md',
      topicRepo: 'GitHub 仓库',
      topicRepoHint: '例如 https://github.com/owner/repo',
      topicTitle: '课题名称（可选）',
      topicKeywords: '课题关键词（可选，逗号分隔）',
      addTopic: '引入课题',
      topicEmpty: '还没有课题。引入后，首次扫描会要求 agent 阅读材料并补全结构化描述。',
      topicPending: '待补全',
      topicReady: '已就绪',
      topicAuto: '自动把课题关键词加入检索',
      topicMax: '每轮课题查询数',
      topicMaxHint: '0 = 不额外查询；建议 1–2，避免检索过宽。',
      openalexEmail: 'OpenAlex 联系邮箱',
      pubmedEmail: 'PubMed 联系邮箱',
      pubmedKey: 'NCBI / PubMed API key',
      pubmedKeyHint: '可选；配置后 NCBI E-utilities 从 3 次/秒提升到 10 次/秒。key 只写不读，保存在 ~/.dsh/sci.secrets.json。',
      crossrefEmail: 'Crossref 联系邮箱',
      unpaywall: 'Unpaywall（OA 解析）',
      unpaywallEmail: 'Unpaywall 邮箱',
      sourceEmailHint: '用于礼貌池/接口识别；留空则用全局兜底。',
      sources: '检索源',
      lookback: '回看天数',
      perSource: '每源条数',
      maxCandidates: '每轮候选数',
      seenDays: '已推荐去重天数',
      seenDaysHint: '推荐过的论文在这段时间内不再重复出现；默认 14 天',
      preprints: '包含预印本',
      evidenceMode: '证据模式',
      evidenceClinical: '临床（预印本不作疗效证据）',
      evidenceBasic: '基础/机制（可含预印本）',
      evidenceMethods: '方法学（偏 AI/统计）',
      evidenceComputational: '生物信息/计算（预印本可用）',
      pico: 'PICO / 研究问题',
      picoHint: '填了 PICO 就优先用 PICO 检索；空着才用关键词',
      population: '人群（P）',
      populationHint: '例如 adults with type 2 diabetes',
      intervention: '干预/暴露（I/E）',
      interventionHint: '例如 GLP-1 receptor agonist',
      comparator: '对照（C）',
      comparatorHint: '例如 placebo / standard care',
      outcome: '主要结局（O）',
      outcomeHint: '例如 HbA1c change / MACE',
      studyTypes: '限定研究类型',
      studyTypesHint: '逗号分隔，可空。例如 Randomized Controlled Trial, Meta-Analysis, Guideline',
      issns: '常看期刊 ISSN',
      issnsHint: '逗号分隔，例如 0028-4793；比刊名缩写更可靠',
      discoveryOA: '发现阶段只要 OA',
      discoveryOAHint: '默认关：关键试验常不在 OA 期刊；关掉后能看到摘要，读全文仍只走 OA',
      includeEditorials: '包含社论/评论/来信',
      includeEditorialsHint: '默认关；这些不是研究证据',
      includeGuidelines: '包含指南/共识',
      includeGuidelinesHint: '默认开；指南通常是最高层级证据',
      titleAbs: '标题/摘要字段检索',
      titleAbsHint: 'Europe PMC/PubMed 用 TITLE_ABS/[tiab] 限定，提升精度',
      synonym: '同义词扩展',
      synonymHint: 'Europe PMC synonym=true；会提高召回，也可能引入噪声',
      downloadFigures: '下载图片',
      dbEnrich: '读文章时做数据库核对',
      pubtator: '使用 PubTator 实体注释',
      pubtatorHint: '用 PubTator 3 补充基因/疾病/药物/变异候选；仍由本地数据库核对。',
      dbEnrichHint: '自动解析基因/变异/accession 并用 NCBI/Ensembl/UniProt/ClinVar 等核对；只使用返回字段，避免模型记忆。',
      dbMaxEntities: '最多核对实体数',
      dbMaxEntitiesHint: '1–30；越大越慢，建议 5–10',
      downloadFiguresHint: '从 PMC/HTML 提取图片到 library/figures，再用 read_image 看',
      maxFigures: '每篇最多图片数',
      privacy: '隐私',
      redactQueries: '日志脱敏',
      redactQueriesHint: '把邮箱/电话/病历号从检索日志里替换掉（不改实际查询）',
      logQueries: '记录检索词',
      logQueriesHint: '关闭后 brief 仍可运行，但 log.jsonl 不落检索词',
      retracted: '撤稿',
      preprintsCount: '预印本',
      repos: '包含仓库/预印本平台',
      reposHint: 'Zenodo / SSRN / Research Square 等；默认关，避免把数据集说明当期刊论文',
      daysHint: '周一到周日；只在选中的日子排班',
      schedule: '科研作息',
      scheduleMode: '运行模式',
      modeManual: '手动模式',
      modeAuto: '自动模式（DSH 自动化任务）',
      scheduleModeHint: '自动模式会在 DSH 自动化任务里创建 weekly 任务；手动模式不自动唤醒，只使用下方按钮。',
      manualHint: '手动模式：不会自动排班。需要时点下方「扫描 / 深读 / 周总结」立即执行。',
      autoHint: '自动模式：保存后会在目标会话创建 DSH 自动化任务（按星期/时间）。DSH 原生任务只按精确时间触发，不支持 jitter/skip。',
      nativeTasks: 'DSH 自动化任务',
      nativeSyncError: 'DSH 自动化任务同步失败',
      times: '每天醒来的时间',
      timesHint: '逗号分隔，24 小时制，例如 09:30, 21:30；第一次偏扫描，之后偏深读',
      days: '工作日',
      deepPerWake: '每次深读篇数',
      weekly: '周总结日',
      reading: '阅读',
      chunkChars: '每段字符数',
      chunkCharsHint: 'read 输出分段的上限；太大容易占满上下文',
      downloadPdf: '允许下载 OA PDF',
      keepPdf: 'PDF 保留天数',
      openalexKey: 'OpenAlex API key',
      openalexKeyHint: '免费申请：openalex.org/settings/api。不填也能用，但共享额度用完会失败',
      saveKey: '保存 key',
      keySaved: 'key 已保存',
      keyCleared: 'key 已清除',
      clearKey: '清除',
      advanced: '数据与诊断',
      dataDir: '数据目录',
      configFile: '配置文件',
      nodePath: 'Node',
      session: '会话',
      papers: '文献',
      notes: '笔记',
      unread: '未读',
      readingCount: '在读',
      readCount: '已读',
      lastBrief: '最近简报',
      plan: '今日计划',
      noPlan: '今天没有排班',
      depsOk: '体检通过',
      depsFail: '体检有问题',
      depsRunning: '体检中…',
      errLoad: '读取设置失败',
      errSave: '保存失败',
      errDeps: '体检失败',
      errRun: '触发失败',
      runHint: '会在目标执行会话里排一个回合；不会立刻替你读完，agent 会按 AGENTS.md 自己干活。',
      secretSet: '已设置',
      secretUnset: '未设置',
    }
    const EN = {
      nav: 'Research',
      title: 'Research',
      intro: 'Biomedical literature workbench: PICO/PubMed/Europe PMC, study-type and retraction safety, tables/figures, citation chasing, screening, and export.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      reload: 'Reload',
      deps: 'Check dependencies',
      runScan: 'Run a scan now',
      runDeep: 'Run a deep read now',
      runReview: 'Run weekly review now',
      running: 'Queued in session…',
      status: 'Status',
      brief: 'Latest brief',
      noBrief: 'No brief yet. Run a scan or wait for the schedule.',
      research: 'Research profile',
      field: 'Field',
      fieldHint: 'One sentence, e.g. “protein language models for enzyme design”',
      keywords: 'Keywords',
      keywordsHint: 'Comma separated; the first three drive each scan',
      venues: 'Venues you follow',
      venuesHint: 'Comma separated; matches in venue get a small boost',
      methods: 'Methods / evidence you care about',
      methodsHint: 'e.g. benchmark, ablation, external validation',
      exclude: 'Exclude terms',
      excludeHint: 'Downrank hits such as editorial, correction',
      execution: 'Execution target',
      execHint: 'Which DSH workspace/session the schedule runs in.',
      execSession: 'Execution session',
      execSessionHint: 'Lists sessions in the selected workspace; choose New session to create one.',
      execWorkspace: 'Workspace',
      defaultWorkspace: 'Default workspace',
      execWorkspaceHint: 'Matches the DSH sidebar workspace list; the no-workspace option is the plugin data directory, not a DSH workspace. Sessions are detected from the selected workspace.',
      refreshTargets: 'Refresh workspaces/sessions',
      newSession: '＋ New session',
      noWorkspace: 'No workspace (data directory)',
      ungrouped: 'Ungrouped',
      pickFolder: 'Choose folder…',
      output: 'Output',
      dataDirInternal: 'Data directory (internal)',
      dataDirInternalHint: 'Records, full text, PDFs, figures and cache stay here; they do not move with the output directory.',
      outputDir: 'Custom output directory',
      outputDirHint: 'Empty = ~/.dsh/sci. Notes, briefs, reviews and search strategies go here; library/cache stay in the data directory.',
      outputResolved: 'Resolved output',
      topics: 'Research topics',
      topicsHint: 'Import a local file/folder or GitHub repo; the agent reads it and fills PROJECT.md, then search adds its keywords.',
      topicPath: 'Local file/folder path',
      topicPathHint: 'e.g. ~/projects/my-lab or ~/papers/idea.md',
      topicRepo: 'GitHub repository',
      topicRepoHint: 'e.g. https://github.com/owner/repo',
      topicTitle: 'Topic title (optional)',
      topicKeywords: 'Topic keywords (optional, comma separated)',
      addTopic: 'Add topic',
      topicEmpty: 'No topics yet. After import, the first scan asks the agent to read and describe the project.',
      topicPending: 'Needs review',
      topicReady: 'Ready',
      topicAuto: 'Add topic keywords to search automatically',
      topicMax: 'Topic queries per scan',
      topicMaxHint: '0 = no extra queries; 1–2 is usually enough.',
      openalexEmail: 'OpenAlex contact email',
      pubmedEmail: 'PubMed contact email',
      pubmedKey: 'NCBI / PubMed API key',
      pubmedKeyHint: 'Optional; raises NCBI E-utilities from 3 to 10 requests/sec. Write-only, stored in ~/.dsh/sci.secrets.json.',
      crossrefEmail: 'Crossref contact email',
      unpaywall: 'Unpaywall (OA lookup)',
      unpaywallEmail: 'Unpaywall email',
      sourceEmailHint: 'Used for polite pools / API identification; global fallback if empty.',
      sources: 'Sources',
      lookback: 'Lookback days',
      perSource: 'Per source',
      maxCandidates: 'Candidates per scan',
      seenDays: 'Hide seen papers for (days)',
      seenDaysHint: 'Do not re-recommend papers surfaced within this window',
      preprints: 'Include preprints',
      evidenceMode: 'Evidence mode',
      evidenceClinical: 'Clinical (preprints not efficacy evidence)',
      evidenceBasic: 'Basic/mechanistic (preprints allowed)',
      evidenceMethods: 'Methods (AI/statistics)',
      evidenceComputational: 'Bioinformatics / computational (preprints allowed)',
      pico: 'PICO / question',
      picoHint: 'If filled, PICO drives the query',
      population: 'Population (P)',
      populationHint: 'e.g. adults with type 2 diabetes',
      intervention: 'Intervention/exposure (I/E)',
      interventionHint: 'e.g. GLP-1 receptor agonist',
      comparator: 'Comparator (C)',
      comparatorHint: 'e.g. placebo / standard care',
      outcome: 'Outcome (O)',
      outcomeHint: 'e.g. HbA1c change / MACE',
      studyTypes: 'Study type filter',
      studyTypesHint: 'Comma separated, optional. e.g. Randomized Controlled Trial, Meta-Analysis, Guideline',
      issns: 'Journal ISSN watchlist',
      issnsHint: 'Comma separated, e.g. 0028-4793',
      discoveryOA: 'Open access only (discovery)',
      discoveryOAHint: 'Off by default; abstracts still visible, full text remains OA-only',
      includeEditorials: 'Include editorials/comments/letters',
      includeEditorialsHint: 'Off by default; not research evidence',
      includeGuidelines: 'Include guidelines/consensus',
      includeGuidelinesHint: 'On by default',
      titleAbs: 'Title/abstract field search',
      titleAbsHint: 'Uses TITLE_ABS/[tiab] for precision',
      synonym: 'Synonym expansion',
      synonymHint: 'Europe PMC synonym=true; more recall, more noise',
      downloadFigures: 'Download figures',
      dbEnrich: 'Database grounding while reading',
      pubtator: 'Use PubTator entity annotations',
      pubtatorHint: 'Adds gene/disease/drug/variant candidates from PubTator 3; the local databases still verify them.',
      dbEnrichHint: 'Resolve genes/variants/accessions against NCBI/Ensembl/UniProt/ClinVar; use returned fields only.',
      dbMaxEntities: 'Max entities to ground',
      dbMaxEntitiesHint: '1–30; larger is slower; 5–10 is typical.',
      downloadFiguresHint: 'Extract PMC/HTML figures to library/figures',
      maxFigures: 'Max figures per paper',
      privacy: 'Privacy',
      redactQueries: 'Redact logs',
      redactQueriesHint: 'Replace emails/phones/MRNs in search logs',
      logQueries: 'Log search terms',
      logQueriesHint: 'Turn off to keep queries out of log.jsonl',
      retracted: 'Retracted',
      preprintsCount: 'Preprints',
      repos: 'Include repositories',
      reposHint: 'Zenodo / SSRN / Research Square, etc.; off by default',
      daysHint: 'Only schedule on selected weekdays',
      schedule: 'Schedule',
      scheduleMode: 'Mode',
      modeManual: 'Manual',
      modeAuto: 'Automatic (DSH tasks)',
      scheduleModeHint: 'Automatic creates weekly DSH automation tasks; Manual never wakes automatically and uses the buttons below.',
      manualHint: 'Manual mode: no automatic wake. Click Scan / Deep / Review below when needed.',
      autoHint: 'Automatic mode creates weekly DSH automation tasks for the target session. DSH native tasks fire at exact times and do not support jitter/skip.',
      nativeTasks: 'DSH automation tasks',
      nativeSyncError: 'DSH automation sync failed',
      times: 'Wake times',
      timesHint: 'Comma separated, 24h, e.g. 09:30, 21:30',
      days: 'Weekdays',
      deepPerWake: 'Deep reads per wake',
      weekly: 'Weekly review day',
      reading: 'Reading',
      chunkChars: 'Characters per chunk',
      chunkCharsHint: 'Upper bound for read output chunks',
      downloadPdf: 'Download OA PDFs',
      keepPdf: 'Keep PDFs (days)',
      openalexKey: 'OpenAlex API key',
      openalexKeyHint: 'Free at openalex.org/settings/api',
      saveKey: 'Save key',
      keySaved: 'Key saved',
      keyCleared: 'Key cleared',
      clearKey: 'Clear',
      advanced: 'Data & diagnostics',
      dataDir: 'Data directory',
      configFile: 'Config file',
      nodePath: 'Node',
      session: 'Session',
      papers: 'Papers',
      notes: 'Notes',
      unread: 'Unread',
      readingCount: 'Reading',
      readCount: 'Read',
      lastBrief: 'Latest brief',
      plan: 'Today',
      noPlan: 'No schedule today',
      depsOk: 'Dependencies OK',
      depsFail: 'Dependency problems',
      depsRunning: 'Checking…',
      errLoad: 'Failed to load settings',
      errSave: 'Save failed',
      errDeps: 'Dependency check failed',
      errRun: 'Could not start',
      runHint: 'Queues one turn in the target execution session; the agent then follows AGENTS.md.',
      secretSet: 'set',
      secretUnset: 'not set',
    }

    const CSS = [
      '.sci{max-width:820px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:6px;padding-bottom:24px}',
      '.sci-title{margin:0;font-size:16px;font-weight:600;line-height:24px}',
      '.sci-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 6px;font-size:13px;line-height:20px}',
      '.sci-group{margin-top:18px;font-size:13px;font-weight:600;line-height:20px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.sci-group:first-of-type{border-top:none;padding-top:0}',
      '.sci-rows{display:flex;flex-direction:column}',
      '.sci-row{display:flex;justify-content:space-between;align-items:flex-start;gap:10px 22px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);flex-wrap:wrap}',
      '.sci-row:last-child{border-bottom:none}',
      '.sci-row>div:first-child{flex:1;min-width:210px}',
      '.sci-label{font-size:13px;line-height:19px}',
      '.sci-hint{color:var(--dsw-alias-label-tertiary);margin-top:3px;font-size:11.5px;line-height:17px}',
      '.sci-input,.sci-select{background:transparent;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;color:var(--dsw-alias-label-primary);font-size:12.5px;height:30px;padding:0 8px;min-width:190px;outline:none}',
      '.sci-input:focus-visible,.sci-select:focus-visible{border-color:var(--dsw-alias-brand-primary)}',
      '.sci-input.sci-wide{min-width:280px}',
      '.sci-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px;padding-top:14px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.sci-btn{background:var(--dsw-alias-brand-primary);color:#fff;border:none;border-radius:6px;font-size:12.5px;height:30px;padding:0 12px;cursor:pointer}',
      '.sci-btn:disabled{opacity:.5;cursor:default}',
      '.sci-btn2{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}',
      '.sci-out{white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.08);border-radius:8px;padding:10px 12px;max-height:260px;overflow:auto;margin-top:10px}',
      '.sci-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px}',
      '.sci-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;line-height:18px;margin-top:8px}',
      '.sci-badge{display:inline-block;font-size:11px;line-height:16px;padding:1px 7px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px}',
      '.sci-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:8px 0 4px}',
      '.sci-card{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 10px}',
      '.sci-card b{display:block;font-size:18px;font-weight:600;line-height:24px}',
      '.sci-card span{color:var(--dsw-alias-label-tertiary);font-size:11px}',
      '.sci-days{display:flex;gap:6px;flex-wrap:wrap}',
      '.sci-day{border:1px solid var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);height:28px;min-width:32px;cursor:pointer;font-size:12px}',
      '.sci-day.on{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}',
      '.sci-source{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:9px 11px;margin:6px 0}',
      '.sci-source-head{display:flex;align-items:flex-start;gap:8px;cursor:pointer}',
      '.sci-source-head>input{margin-top:3px}',
      '.sci-source-opts{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.sci-source-opt{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap}',
      '.sci-source-opt>div:first-child{flex:1;min-width:170px}',
      '.sci-details{margin-top:8px}',
      '.sci-modal{position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;padding:24px}',
      '.sci-modal-box{width:min(460px,92vw);background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-1,#fff));color:var(--dsw-alias-label-primary,inherit);border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:18px;box-shadow:0 16px 48px rgba(0,0,0,.28)}',
      '.sci-modal-title{font-weight:600;font-size:15px;margin-bottom:6px}',
      '.sci-details summary{cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.sci-brief{white-space:pre-wrap;font-size:12px;line-height:19px;color:var(--dsw-alias-label-secondary);max-height:420px;overflow:auto;background:rgba(127,127,127,.06);border-radius:8px;padding:10px 12px;margin-top:8px}',
    ].join('')

    function useStyleOnce() {
      useEffect(() => {
        if (typeof document === 'undefined') return
        const id = 'dsh-sci/settings.css'
        if (!document.getElementById(id)) {
          const el = document.createElement('style')
          el.id = id
          el.textContent = CSS
          document.head.appendChild(el)
        }
      }, [])
    }

    const getPath = (obj, p) => p.reduce((o, k) => (o == null ? undefined : o[k]), obj)
    function setPath(obj, p, value) {
      let cur = obj
      for (let i = 0; i < p.length - 1; i += 1) {
        const k = p[i]
        if (cur[k] == null || typeof cur[k] !== 'object') cur[k] = {}
        cur = cur[k]
      }
      cur[p[p.length - 1]] = value
    }
    const clone = (x) => JSON.parse(JSON.stringify(x))

    async function api(path, options = {}) {
      const res = await fetch(API + path, {
        ...options,
        headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
        credentials: 'same-origin',
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
      return data
    }

    function Row({ label, hint, children, readOnly }) {
      return h('div', { className: 'sci-row' },
        h('div', null,
          h('div', { className: 'sci-label' }, label, readOnly ? h('span', { className: 'sci-badge' }, '只读') : null),
          hint ? h('div', { className: 'sci-hint' }, hint) : null),
        children)
    }

    function TextRow({ label, hint, value, onChange, wide, placeholder, type = 'text' }) {
      return h(Row, { label, hint },
        h('input', {
          className: 'sci-input' + (wide ? ' sci-wide' : ''),
          type, step: type === 'number' ? 'any' : undefined, value: value ?? '', placeholder: placeholder ?? '',
          onChange: (e) => onChange(type === 'number' ? (e.target.value === '' ? 0 : Number(e.target.value)) : e.target.value),
        }))
    }

    function PathRow({ label, hint, value, onChange, pick, placeholder, buttonLabel = '选择…' }) {
      return h(Row, { label, hint },
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', { className: 'sci-input', value: value ?? '', placeholder: placeholder || '', onChange: (e) => onChange(e.target.value), style: { minWidth: 220, flex: 1 } }),
          h('button', { className: 'sci-btn sci-btn2', disabled: !pick, onClick: async () => { try { const p = await pick(); if (p) onChange(p) } catch {} } }, buttonLabel)))
    }

    function SelectRow({ label, hint, value, onChange, options = [] }) {
      return h(Row, { label, hint },
        h('select', {
          className: 'sci-input',
          value: value ?? '',
          onChange: (e) => onChange(e.target.value),
        }, options.map((o) => h('option', { value: o.value, key: o.value }, o.label))))
    }

    function ListRow({ label, hint, value, onChange }) {
      const joined = Array.isArray(value) ? value.join('，') : (value ?? '')
      const [text, setText] = useState(joined)
      useEffect(() => { setText(Array.isArray(value) ? value.join('，') : (value ?? '')) }, [JSON.stringify(value ?? null)])
      return h(Row, { label, hint },
        h('input', {
          className: 'sci-input sci-wide', value: text,
          onChange: (e) => {
            const v = e.target.value
            setText(v)
            onChange(v.split(/[,，]/).map((s) => s.trim()).filter(Boolean))
          },
        }))
    }

    function Switch({ checked, onChange, disabled }) {
      return h('input', { type: 'checkbox', checked: !!checked, disabled, onChange: (e) => onChange(e.target.checked) })
    }

    function SwitchRow({ label, hint, checked, onChange, disabled }) {
      return h(Row, { label, hint }, h(Switch, { checked, onChange, disabled }))
    }

    function TimesRow({ label, hint, value, onChange }) {
      const [text, setText] = useState((value ?? []).join(', '))
      useEffect(() => { setText((value ?? []).join(', ')) }, [JSON.stringify(value ?? null)])
      return h(Row, { label, hint },
        h('input', {
          className: 'sci-input sci-wide', value: text,
          onChange: (e) => {
            const v = e.target.value
            setText(v)
            const times = v.split(/[,，]/).map((s) => s.trim()).filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s))
            if (times.length) onChange(times)
          },
        }))
    }

    function SourceRow({ cfg, update, secrets, keyInput, setKeyInput, saveKey, clearKey, pubmedKeyInput, setPubmedKeyInput, savePubmedKey, clearPubmedKey, busy, t }) {
      const s = cfg.sources ?? {}
      const opts = s.options ?? {}
      const emailField = (source, label, hint) => h('div', { className: 'sci-source-opt' },
        h('div', null, h('div', { className: 'sci-label' }, label), h('div', { className: 'sci-hint' }, hint || t('sourceEmailHint'))),
        h('input', {
          className: 'sci-input', type: 'email',
          value: opts[source]?.email ?? '',
          placeholder: 'name@example.com',
          onChange: (e) => update((d) => {
            d.sources.options ??= {}
            d.sources.options[source] ??= {}
            d.sources.options[source].email = e.target.value
          }),
        }))
      const box = (key, label, hint, extra = null) => h('div', { className: 'sci-source', key },
        h('label', { className: 'sci-source-head' },
          h('input', { type: 'checkbox', checked: !!s[key], onChange: (e) => update((d) => { d.sources[key] = e.target.checked }) }),
          h('div', null, h('div', { className: 'sci-label' }, label), h('div', { className: 'sci-hint' }, hint))),
        s[key] && extra ? h('div', { className: 'sci-source-opts' }, extra) : null)
      const secretBox = (label, hint, secretKey, value, setValue, save, clear, busyKey) => h('div', { className: 'sci-source-opt' },
        h('div', null, h('div', { className: 'sci-label' }, label), h('div', { className: 'sci-hint' }, hint)),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
          h('input', {
            className: 'sci-input', type: 'password', value,
            placeholder: secrets[secretKey] ? t('secretSet') : t('secretUnset'),
            onChange: (e) => setValue(e.target.value), style: { minWidth: 200 },
          }),
          h('button', { className: 'sci-btn sci-btn2', disabled: !value.trim() || busy === busyKey, onClick: save }, t('saveKey')),
          secrets[secretKey] ? h('button', { className: 'sci-btn sci-btn2', disabled: busy === busyKey, onClick: clear }, t('clearKey')) : null,
          h('span', { className: 'sci-badge' }, secrets[secretKey] ? t('secretSet') : t('secretUnset'))))
      const keyBox = secretBox(t('openalexKey'), t('openalexKeyHint'), 'openalexApiKey', keyInput, setKeyInput, saveKey, clearKey, 'key')
      return h('div', null,
        h('div', { className: 'sci-group' }, t('sources')),
        h('div', { className: 'sci-hint', style: { marginBottom: 8 } }, 'Europe PMC + PubMed 是生物医学主力；OpenAlex 补跨学科；ClinicalTrials.gov 补注册信息。每个源的邮箱/API 设置直接放在对应源下。'),
        box('europepmc', 'Europe PMC', 'PubMed/PMC + 预印本；开放全文 XML；无需 key'),
        box('pubmed', 'PubMed', 'MeSH/[tiab]/[pt] 字段检索；配置 key 后 10 请求/秒', h('div', null,
          emailField('pubmed', t('pubmedEmail')),
          secretBox(t('pubmedKey'), t('pubmedKeyHint'), 'ncbiApiKey', pubmedKeyInput, setPubmedKeyInput, savePubmedKey, clearPubmedKey, 'pubmed-key'))),
        box('openalex', 'OpenAlex', '跨学科题录；无 key 时共享额度，可能被限', h('div', null,
          emailField('openalex', t('openalexEmail')),
          keyBox)),
        box('clinicaltrials', 'ClinicalTrials.gov', '试验注册信息；brief 会附相关试验'),
        box('crossref', 'Crossref', 'DOI 权威元数据；摘要覆盖一般，默认关', emailField('crossref', t('crossrefEmail'))),
        box('arxiv', 'arXiv', '预印本；临床模式默认关'),
        h('div', { className: 'sci-group' }, t('unpaywall')),
        h('div', { className: 'sci-hint', style: { marginBottom: 6 } }, '用 DOI 找合法 OA 版本；需要邮箱。'),
        h('div', { className: 'sci-source' }, h('div', { className: 'sci-source-opts', style: { borderTop: 'none', paddingTop: 0, marginTop: 0 } },
          emailField('unpaywall', t('unpaywallEmail')))))
    }

    function DaysRow({ value, onChange, t }) {
      const days = Array.isArray(value) ? value : []
      return h(Row, { label: t('days'), hint: t('daysHint') },
        h('div', { className: 'sci-days' },
          [1, 2, 3, 4, 5, 6, 7].map((n) => h('button', {
            key: n, type: 'button',
            className: 'sci-day' + (days.includes(n) ? ' on' : ''),
            onClick: () => onChange(days.includes(n) ? days.filter((x) => x !== n) : [...days, n].sort((a, b) => a - b)),
          }, t(`wd${n}`)))))
    }

    function StatusCards({ status, t }) {
      const s = status?.stats
      if (!s) return null
      const card = (label, value) => h('div', { className: 'sci-card', key: label }, h('b', null, String(value ?? 0)), h('span', null, label))
      return h('div', { className: 'sci-cards' },
        card(t('papers'), s.papers), card(t('notes'), s.notes),
        card(t('unread'), s.unread), card(t('readingCount'), s.reading), card(t('readCount'), s.read),
        card(t('retracted'), s.retracted), card(t('preprintsCount'), s.preprints))
    }

    function PlanLine({ status, t }) {
      const nt = status?.nativeTasks
      if (nt?.length) return h('div', { className: 'sci-hint' }, `${t('nativeTasks')}：${nt.map((x) => x.title).join(' · ')}`)
      return h('div', { className: 'sci-hint' }, t('noPlan'))
    }

    function installNavIcon(labelOf) {
      if (typeof document === 'undefined') return () => {}
      const NS = 'http://www.w3.org/2000/svg'
      const decorate = () => {
        const root = document.querySelector('[data-dsh-surface="settings"]')
        if (!root) return
        const label = String(labelOf() ?? '').trim()
        if (!label) return
        for (const btn of root.querySelectorAll('button')) {
          if ((btn.textContent || '').trim() !== label) continue
          const old = btn.querySelector('svg')
          if (!old || old.getAttribute('data-dsh-sci-nav-icon') === '1') continue
          const svg = document.createElementNS(NS, 'svg')
          svg.setAttribute('width', '16')
          svg.setAttribute('height', '16')
          svg.setAttribute('viewBox', '0 0 16 16')
          svg.setAttribute('fill', 'none')
          svg.setAttribute('stroke', 'currentColor')
          svg.setAttribute('stroke-width', '1.15')
          svg.setAttribute('stroke-linecap', 'round')
          svg.setAttribute('stroke-linejoin', 'round')
          svg.setAttribute('aria-hidden', 'true')
          svg.setAttribute('data-dsh-sci-nav-icon', '1')
          if (old.getAttribute('class')) svg.setAttribute('class', old.getAttribute('class'))
          for (const d of [
            'M2.2 3.4c1.5-.55 3.1-.55 4.6 0v8c-1.5-.55-3.1-.55-4.6 0z',
            'M6.8 3.4c1.5-.55 3.1-.55 4.6 0v3.1',
            'M8.2 11.4c1.1-.4 2.3-.4 3.5 0',
          ]) {
            const path = document.createElementNS(NS, 'path')
            path.setAttribute('d', d)
            svg.appendChild(path)
          }
          const circle = document.createElementNS(NS, 'circle')
          circle.setAttribute('cx', '11.2')
          circle.setAttribute('cy', '8')
          circle.setAttribute('r', '2')
          svg.appendChild(circle)
          const handle = document.createElementNS(NS, 'path')
          handle.setAttribute('d', 'M12.6 9.4l2 2')
          svg.appendChild(handle)
          old.replaceWith(svg)
          btn.setAttribute('data-dsh-sci-nav', '1')
        }
      }
      let queued = false
      const schedule = () => {
        if (queued) return
        queued = true
        queueMicrotask(() => { queued = false; try { decorate() } catch {} })
      }
      if (!document.body) return () => {}
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true })
      schedule()
      return () => {
        observer.disconnect()
        for (const btn of document.querySelectorAll('[data-dsh-sci-nav]')) btn.removeAttribute('data-dsh-sci-nav')
      }
    }

    function Section({ t, pickDirectory, close }) {
      useStyleOnce()
      const [cfg, setCfg] = useState(null)
      const [secrets, setSecrets] = useState({})
      const [status, setStatus] = useState(null)
      const [brief, setBrief] = useState(null)
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [deps, setDeps] = useState(null)
      const [keyInput, setKeyInput] = useState('')
      const [pubmedKeyInput, setPubmedKeyInput] = useState('')
      const [dirty, setDirty] = useState(false)
      const [pendingClose, setPendingClose] = useState(false)
      const dirtyRef = useRef(false)
      const closeTargetRef = useRef(null)
      const [targets, setTargets] = useState(null)
      const [topics, setTopics] = useState([])
      const [topicPath, setTopicPath] = useState('')
      const [topicRepo, setTopicRepo] = useState('')
      const [topicTitle, setTopicTitle] = useState('')
      const [topicKeywords, setTopicKeywords] = useState('')

      const update = useCallback((fn) => {
        setCfg((prev) => {
          if (!prev) return prev
          const next = clone(prev)
          fn(next)
          return next
        })
        setDirty(true)
        dirtyRef.current = true
      }, [])

      const load = useCallback(async () => {
        setError('')
        try {
          const [s, st, tg, tp] = await Promise.all([
            api('/settings'),
            api('/status').catch(() => null),
            api('/targets').catch(() => null),
            api('/topics').catch(() => ({ topics: [] })),
          ])
          setCfg(s.config)
          setDirty(false)
          dirtyRef.current = false
          setSecrets(s.secrets ?? {})
          if (st) setStatus(st)
          if (tg) setTargets(tg)
          setTopics(tp.topics ?? [])
          try {
            const b = await api('/brief')
            setBrief(b.brief ?? null)
          } catch { setBrief(null) }
        } catch (e) {
          setError(`${t('errLoad')}：${e.message}`)
        }
      }, [t])

      const refreshTargets = async () => {
        setError('')
        try {
          const [tg, tp, st] = await Promise.all([api('/targets').catch(() => null), api('/topics').catch(() => ({ topics: [] })), api('/status').catch(() => null)])
          if (tg) setTargets(tg)
          setTopics(tp.topics ?? [])
          if (st) setStatus(st)
        } catch (e) { setError(String(e.message)) }
      }

      const addTopic = async () => {
        if (!topicPath.trim() && !topicRepo.trim()) return
        setBusy('topic'); setError(''); setNotice('')
        try {
          const body = {
            path: topicPath.trim(), repo: topicRepo.trim(), title: topicTitle.trim(),
            keywords: topicKeywords.split(',').map((x) => x.trim()).filter(Boolean),
          }
          const r = await api('/topics', { method: 'POST', body: JSON.stringify(body) })
          setTopics(r.topics ?? [])
          setTopicPath(''); setTopicRepo(''); setTopicTitle(''); setTopicKeywords('')
          setNotice(`已引入课题：${r.topic?.title ?? ''}。${r.queued ? '已排队让 agent 建档。' : '首次扫描会要求 agent 阅读材料并补全 PROJECT.md。'}`)
        } catch (e) { setError(String(e.message)) } finally { setBusy('') }
      }

      const toggleTopic = (id) => {
        if (!cfg) return
        const all = topics.map((x) => x.id)
        const current = (cfg.topics?.selected?.length ? cfg.topics.selected : all)
        const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
        update((d) => { d.topics.selected = next.length === all.length ? [] : next })
      }

      useEffect(() => { load() }, [load])

      const save = async () => {
        if (!cfg) return
        setBusy('save'); setError(''); setNotice('')
        try {
          const r = await api('/settings', { method: 'POST', body: JSON.stringify({ config: cfg }) })
          setCfg(r.config)
          setDirty(false)
          dirtyRef.current = false
          setSecrets(r.secrets ?? {})
          setNotice(r.nativeSchedule && r.nativeSchedule.ok === false ? `${t('saved')}；自动化任务同步失败：${r.nativeSchedule.error || '未知错误'}` : t('saved'))
          try { setStatus(await api('/status')) } catch {}
          return true
        } catch (e) {
          setError(`${t('errSave')}：${e.message}`)
          return false
        } finally { setBusy('') }
      }

      const saveKey = async () => {
        if (!keyInput.trim()) return
        setBusy('key'); setError(''); setNotice('')
        try {
          const r = await api('/secrets', { method: 'POST', body: JSON.stringify({ set: { openalexApiKey: keyInput.trim() } }) })
          setSecrets(r.secrets ?? {})
          setKeyInput('')
          setNotice(t('keySaved'))
        } catch (e) {
          setError(String(e.message))
        } finally { setBusy('') }
      }

      const reload = () => {
        if (dirtyRef.current && !window.confirm(t('discardReload'))) return
        load()
      }

      const saveSilently = async () => {
        const r = await api('/settings', { method: 'POST', body: JSON.stringify({ config: cfg }) })
        setCfg(r.config)
        setDirty(false)
        dirtyRef.current = false
        setSecrets(r.secrets ?? {})
      }

      const clearKey = async () => {
        setBusy('key'); setError(''); setNotice('')
        try {
          const r = await api('/secrets', { method: 'POST', body: JSON.stringify({ clear: ['openalexApiKey'] }) })
          setSecrets(r.secrets ?? {})
          setKeyInput('')
          setNotice(t('keySaved'))
        } catch (e) {
          setError(String(e.message))
        } finally { setBusy('') }
      }

      const savePubmedKey = async () => {
        if (!pubmedKeyInput.trim()) return
        setBusy('pubmed-key'); setError(''); setNotice('')
        try {
          const r = await api('/secrets', { method: 'POST', body: JSON.stringify({ set: { ncbiApiKey: pubmedKeyInput.trim() } }) })
          setSecrets(r.secrets ?? {})
          setPubmedKeyInput('')
          setNotice(t('keySaved'))
        } catch (e) { setError(String(e.message)) } finally { setBusy('') }
      }

      const clearPubmedKey = async () => {
        setBusy('pubmed-key'); setError(''); setNotice('')
        try {
          const r = await api('/secrets', { method: 'POST', body: JSON.stringify({ clear: ['ncbiApiKey'] }) })
          setSecrets(r.secrets ?? {})
          setNotice(t('keyCleared'))
        } catch (e) { setError(String(e.message)) } finally { setBusy('') }
      }

      useEffect(() => {
        if (!cfg) return
        const isClose = (el) => {
          const btn = el?.closest?.('button')
          if (!btn) return null
          const text = String(btn.textContent ?? '').trim()
          const aria = String(btn.getAttribute('aria-label') ?? '').trim()
          const title = String(btn.getAttribute('title') ?? '').trim()
          const exact = /^(关闭|關閉|close)$/i
          return exact.test(text) || exact.test(aria) || exact.test(title) ? btn : null
        }
        const onClick = (e) => {
          if (!dirtyRef.current) return
          if (e.target?.closest?.('.sci-modal')) return
          const btn = isClose(e.target)
          if (!btn || !btn.closest('[data-dsh-surface="settings"]')) return
          e.preventDefault(); e.stopPropagation()
          closeTargetRef.current = btn
          setPendingClose(true)
        }
        const onKey = (e) => {
          if (!dirtyRef.current || e.key !== 'Escape') return
          e.preventDefault(); e.stopPropagation()
          setPendingClose(true)
        }
        const onUnload = (e) => {
          if (!dirtyRef.current) return
          e.preventDefault(); e.returnValue = ''
        }
        document.addEventListener('click', onClick, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('beforeunload', onUnload)
        return () => {
          document.removeEventListener('click', onClick, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('beforeunload', onUnload)
        }
      }, [cfg])

      const closeUi = () => {
        const target = closeTargetRef.current
        closeTargetRef.current = null
        if (target?.isConnected) { target.click(); return }
        if (typeof close === 'function') { close(); return }
        const btn = document.querySelector('[data-dsh-surface="settings"] button[aria-label*="关闭"], [data-dsh-surface="settings"] button[aria-label*="Close"]')
        if (btn) btn.click()
      }

      const runDeps = async () => {
        setBusy('deps'); setError(''); setDeps(null)
        try {
          await saveSilently()
          const r = await api('/deps')
          setDeps(r)
        } catch (e) {
          setError(`${t('errDeps')}：${e.message}`)
        } finally { setBusy('') }
      }

      const run = async (kind) => {
        setBusy(kind); setError(''); setNotice('')
        try {
          // 先落盘：否则「刚改的方向」不会进入这一轮。
          await saveSilently()
          const r = await api('/run', { method: 'POST', body: JSON.stringify({ kind }) })
          setNotice(r.message || t('running'))
        } catch (e) {
          setError(`${t('errRun')}：${e.message}`)
        } finally { setBusy('') }
      }

      if (!cfg) {
        return h('div', { className: 'sci' },
          h('h2', { className: 'sci-title' }, t('title')),
          error ? h('div', { className: 'sci-err' }, error) : h('div', { className: 'sci-hint' }, '载入中…'))
      }

      const sc = cfg.schedule ?? {}
      const rd = cfg.reading ?? {}
      const rs = cfg.researcher ?? {}
      const topicIds = topics.map((x) => x.id)
      const selectedTopicIds = cfg.topics?.selected?.length ? cfg.topics.selected : topicIds
      const workspaces = targets?.workspaces ?? []
      const sessions = targets?.sessions ?? []
      const currentWs = workspaces.find((w) => w.id === (cfg.execution?.workspaceId ?? ''))
      const inWorkspace = (s) => currentWs
        ? ((currentWs.sessionIds ?? []).includes(s.sessionId) || s.cwd === currentWs.path)
        : s.cwd === status?.dataDir
      const candidateSessions = sessions.filter(inWorkspace).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      const newSessionId = () => `sci-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`}`
      const currentSessionId = cfg.execution?.sessionId ?? ''
      const workspaceLabel = (w) => {
        const title = String(w?.title ?? '').trim()
        if (!title || title === 'default-workspace' || /(^|[\\/])default-workspace$/.test(String(w?.path ?? ''))) return t('defaultWorkspace')
        return title
      }
      const shortId = (id) => String(id ?? '').replace(/^session-/, '').slice(0, 8)
      const sessionLabel = (s) => {
        const title = String(s.title ?? '').trim()
        const cwdBase = String(s.cwd ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
        const name = title || (s.blank ? t('ungrouped') : cwdBase) || shortId(s.sessionId)
        return `${name} — ${shortId(s.sessionId)}${s.running ? ' · 运行中' : ''}`
      }
      const sessionOptions = [
        { value: '__new__', label: t('newSession') },
        ...candidateSessions.map((s) => ({ value: s.sessionId, label: sessionLabel(s) })),
      ]
      if (currentSessionId && !sessionOptions.some((o) => o.value === currentSessionId)) {
        const cur = sessions.find((s) => s.sessionId === currentSessionId)
        sessionOptions.push({ value: currentSessionId, label: cur ? `${sessionLabel(cur)} · 当前` : `${shortId(currentSessionId)}（当前）` })
      }
      const changeWorkspace = (v) => update((d) => {
        d.execution.workspaceId = v
        const ws = workspaces.find((w) => w.id === v)
        const ids = ws?.sessionIds ?? []
        const cur = d.execution.sessionId
        const belongs = ws
          ? (ids.includes(cur) || sessions.some((s) => s.sessionId === cur && s.cwd === ws.path))
          : sessions.some((s) => s.sessionId === cur && s.cwd === status?.dataDir)
        if (!belongs) d.execution.sessionId = ids[0] || newSessionId()
      })
      const changeSession = (v) => update((d) => { d.execution.sessionId = v === '__new__' ? newSessionId() : v })

      return h('div', { className: 'sci' },
        h('h2', { className: 'sci-title' }, t('title')),
        h('p', { className: 'sci-intro' }, t('intro')),

        h('div', { className: 'sci-group' }, t('schedule')),
        h(SelectRow, { label: t('scheduleMode'), hint: t('scheduleModeHint'), value: sc.mode ?? 'auto', options: [
          { value: 'auto', label: t('modeAuto') },
          { value: 'manual', label: t('modeManual') },
        ], onChange: (v) => update((d) => { d.schedule.mode = v }) }),
        sc.mode === 'manual'
          ? h('div', { className: 'sci-hint' }, t('manualHint'))
          : h('div', null,
            h('div', { className: 'sci-hint', style: { marginBottom: 6 } }, t('autoHint')),
            h(TimesRow, { label: t('times'), hint: t('timesHint'), value: sc.times, onChange: (v) => update((d) => { d.schedule.times = v }) }),
            h(DaysRow, { value: sc.days, onChange: (v) => update((d) => { d.schedule.days = v }), t }),
            h(TextRow, { label: t('weekly'), hint: '1=周一 … 7=周日；当天最后一个时段做周总结；DSH 任务按这个提示判断。', type: 'number', value: sc.weeklyReviewDay, onChange: (v) => update((d) => { d.schedule.weeklyReviewDay = v }) }),
            h(TextRow, { label: t('deepPerWake'), hint: '1–3 篇；多了会变成摘要搬运', type: 'number', value: sc.deepReadPerWake, onChange: (v) => update((d) => { d.schedule.deepReadPerWake = v }) }),
            status?.nativeSyncError ? h('div', { className: 'sci-err' }, `${t('nativeSyncError')}：${status.nativeSyncError}`) : null,
            status?.nativeTasks?.length ? h('div', { className: 'sci-hint' }, `${t('nativeTasks')}：${status.nativeTasks.map((x) => x.title).join(' · ')}`) : null),

        h('div', { className: 'sci-actions sci-actions-top' },
          h('button', { className: 'sci-btn', disabled: busy === 'scan', onClick: () => run('scan') }, t('runScan')),
          h('button', { className: 'sci-btn sci-btn2', disabled: busy === 'deep', onClick: () => run('deep') }, t('runDeep')),
          h('button', { className: 'sci-btn sci-btn2', disabled: busy === 'review', onClick: () => run('review') }, t('runReview'))),

        h('div', { className: 'sci-group' }, t('status')),
        h(StatusCards, { status, t }),
        h('div', { className: 'sci-hint' }, `${t('plan')}：`, h(PlanLine, { status, t })),
        status?.lastBrief ? h('div', { className: 'sci-hint' }, `${t('lastBrief')}：${status.lastBrief.date} · ${status.lastBrief.file}`) : null,

        h('div', { className: 'sci-group' }, t('execution')),
        h('div', { className: 'sci-hint', style: { marginBottom: 6 } }, t('execHint')),
        h(SelectRow, {
          label: t('execWorkspace'), hint: t('execWorkspaceHint'), value: cfg.execution?.workspaceId ?? '',
          options: [{ value: '', label: t('noWorkspace') }, ...workspaces.map((w) => ({ value: w.id, label: workspaceLabel(w) }))],
          onChange: changeWorkspace,
        }),
        h(SelectRow, {
          label: t('execSession'), hint: `${t('execSessionHint')}（可检测到 ${candidateSessions.length} 个会话）`,
          value: currentSessionId, options: sessionOptions, onChange: changeSession,
        }),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end' } },
          h('button', { className: 'sci-btn sci-btn2', onClick: refreshTargets }, t('refreshTargets'))),

        h('div', { className: 'sci-group' }, t('output')),
        h(Row, { label: t('dataDirInternal'), hint: t('dataDirInternalHint'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.dataDir ?? '—')),
        h(PathRow, { label: t('outputDir'), hint: t('outputDirHint'), value: cfg.output?.dir ?? '', placeholder: '（留空 = 数据目录）', pick: pickDirectory, buttonLabel: t('pickFolder'), onChange: (v) => update((d) => { d.output = { ...(d.output ?? {}), dir: v } }) }),
        h(Row, { label: t('outputResolved'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.outputDir ?? '—')),
        status?.outputs ? h('div', { className: 'sci-hint', style: { marginLeft: 0 } }, `笔记 ${status.outputs.notes} · 简报 ${status.outputs.briefs} · 周总结 ${status.outputs.reviews} · 检索策略 ${status.outputs.searches}`) : null,

        h('div', { className: 'sci-group' }, t('topics')),
        h('div', { className: 'sci-hint', style: { marginBottom: 8 } }, t('topicsHint')),
        topics.length ? h('div', { className: 'sci-rows' }, topics.map((tp) => h('div', { className: 'sci-source', key: tp.id },
          h('label', { className: 'sci-source-head' },
            h('input', { type: 'checkbox', checked: selectedTopicIds.includes(tp.id), onChange: () => toggleTopic(tp.id) }),
            h('div', null,
              h('div', { className: 'sci-label' }, tp.title, h('span', { className: 'sci-badge' }, tp.status === 'ready' ? t('topicReady') : t('topicPending'))),
              h('div', { className: 'sci-hint' }, `${tp.kind} · ${(tp.keywords ?? []).join(', ') || '无关键词'} · ${tp.project}`)))))) : h('div', { className: 'sci-hint' }, t('topicEmpty')),
        h(PathRow, { label: t('topicPath'), hint: t('topicPathHint'), value: topicPath, pick: pickDirectory, buttonLabel: t('pickFolder'), onChange: setTopicPath }),
        h(TextRow, { label: t('topicRepo'), hint: t('topicRepoHint'), value: topicRepo, wide: true, onChange: setTopicRepo }),
        h(TextRow, { label: t('topicTitle'), value: topicTitle, wide: true, onChange: setTopicTitle }),
        h(TextRow, { label: t('topicKeywords'), value: topicKeywords, wide: true, onChange: setTopicKeywords }),
        h('div', { style: { marginTop: 4 } }, h('button', { className: 'sci-btn sci-btn2', disabled: busy === 'topic' || (!topicPath.trim() && !topicRepo.trim()), onClick: addTopic }, busy === 'topic' ? '处理中…' : t('addTopic'))),
        h(SwitchRow, { label: t('topicAuto'), hint: '把课题关键词加入 brief/search 的 scope', checked: cfg.topics?.autoScope, onChange: (v) => update((d) => { d.topics.autoScope = v }) }),
        h(TextRow, { label: t('topicMax'), hint: t('topicMaxHint'), type: 'number', value: cfg.topics?.maxQueries, onChange: (v) => update((d) => { d.topics.maxQueries = v }) }),

        h('div', { className: 'sci-group' }, t('research')),
        h(TextRow, { label: t('field'), hint: t('fieldHint'), value: rs.field, wide: true, onChange: (v) => update((d) => { d.researcher.field = v }) }),
        h(TextRow, { label: t('species'), hint: t('speciesHint'), value: rs.species, wide: true, onChange: (v) => update((d) => { d.researcher.species = v }) }),
        h(SelectRow, { label: t('evidenceMode'), hint: '临床模式会把预印本降权并默认排除', value: rs.evidenceMode, options: [
          { value: 'clinical', label: t('evidenceClinical') },
          { value: 'basic', label: t('evidenceBasic') },
          { value: 'methods', label: t('evidenceMethods') },
          { value: 'computational', label: t('evidenceComputational') },
        ], onChange: (v) => update((d) => { d.researcher.evidenceMode = v }) }),
        h(ListRow, { label: t('keywords'), hint: t('keywordsHint'), value: rs.keywords, onChange: (v) => update((d) => { d.researcher.keywords = v }) }),
        h(ListRow, { label: t('venues'), hint: t('venuesHint'), value: rs.venues, onChange: (v) => update((d) => { d.researcher.venues = v }) }),
        h(ListRow, { label: t('issns'), hint: t('issnsHint'), value: rs.issns, onChange: (v) => update((d) => { d.researcher.issns = v }) }),
        h(ListRow, { label: t('studyTypes'), hint: t('studyTypesHint'), value: rs.studyTypes, onChange: (v) => update((d) => { d.researcher.studyTypes = v }) }),
        h(ListRow, { label: t('methods'), hint: t('methodsHint'), value: rs.methods, onChange: (v) => update((d) => { d.researcher.methods = v }) }),
        h(ListRow, { label: t('exclude'), hint: t('excludeHint'), value: rs.exclude, onChange: (v) => update((d) => { d.researcher.exclude = v }) }),

        h('div', { className: 'sci-group' }, t('pico')),
        h('div', { className: 'sci-hint', style: { marginBottom: 6 } }, t('picoHint')),
        h(TextRow, { label: t('population'), hint: t('populationHint'), value: rs.pico?.population, wide: true, onChange: (v) => update((d) => { d.researcher.pico.population = v }) }),
        h(TextRow, { label: t('intervention'), hint: t('interventionHint'), value: rs.pico?.intervention, wide: true, onChange: (v) => update((d) => { d.researcher.pico.intervention = v }) }),
        h(TextRow, { label: t('comparator'), hint: t('comparatorHint'), value: rs.pico?.comparator, wide: true, onChange: (v) => update((d) => { d.researcher.pico.comparator = v }) }),
        h(TextRow, { label: t('outcome'), hint: t('outcomeHint'), value: rs.pico?.outcome, wide: true, onChange: (v) => update((d) => { d.researcher.pico.outcome = v }) }),

        h(SourceRow, { cfg, update, secrets, keyInput, setKeyInput, saveKey, clearKey, pubmedKeyInput, setPubmedKeyInput, savePubmedKey, clearPubmedKey, busy, t }),
        h('div', { className: 'sci-rows' },
          h(TextRow, { label: t('lookback'), hint: '默认 14 天；追新可调小，补经典可调大', type: 'number', value: cfg.search?.lookbackDays, onChange: (v) => update((d) => { d.search.lookbackDays = v }) }),
          h(TextRow, { label: t('perSource'), hint: '每个源取多少条；太多会变慢', type: 'number', value: cfg.search?.perSource, onChange: (v) => update((d) => { d.search.perSource = v }) }),
          h(TextRow, { label: t('maxCandidates'), hint: '一轮最多给 agent 看几条候选', type: 'number', value: cfg.search?.maxCandidates, onChange: (v) => update((d) => { d.search.maxCandidates = v }) }),
          h(TextRow, { label: t('seenDays'), hint: t('seenDaysHint'), type: 'number', value: cfg.search?.seenDays, onChange: (v) => update((d) => { d.search.seenDays = v }) }),
          h(SwitchRow, { label: t('discoveryOA'), hint: t('discoveryOAHint'), checked: cfg.search?.discoveryOAOnly, onChange: (v) => update((d) => { d.search.discoveryOAOnly = v }) }),
          h(SwitchRow, { label: t('preprints'), hint: 'medRxiv / bioRxiv / arXiv 等；临床模式默认关', checked: cfg.search?.includePreprints, onChange: (v) => update((d) => { d.search.includePreprints = v }) }),
          h(SwitchRow, { label: t('includeEditorials'), hint: t('includeEditorialsHint'), checked: cfg.search?.includeEditorials, onChange: (v) => update((d) => { d.search.includeEditorials = v }) }),
          h(SwitchRow, { label: t('includeGuidelines'), hint: t('includeGuidelinesHint'), checked: cfg.search?.includeGuidelines, onChange: (v) => update((d) => { d.search.includeGuidelines = v }) }),
          h(SwitchRow, { label: t('repos'), hint: t('reposHint'), checked: cfg.search?.includeRepositories, onChange: (v) => update((d) => { d.search.includeRepositories = v }) }),
          h(SwitchRow, { label: t('titleAbs'), hint: t('titleAbsHint'), checked: cfg.search?.titleAbstractOnly, onChange: (v) => update((d) => { d.search.titleAbstractOnly = v }) }),
          h(SwitchRow, { label: t('synonym'), hint: t('synonymHint'), checked: cfg.search?.synonymExpansion, onChange: (v) => update((d) => { d.search.synonymExpansion = v }) })),

        h('div', { className: 'sci-group' }, t('reading')),
        h(TextRow, { label: t('chunkChars'), hint: t('chunkCharsHint'), type: 'number', value: rd.maxCharsPerChunk, onChange: (v) => update((d) => { d.reading.maxCharsPerChunk = v }) }),
        h(SwitchRow, { label: t('downloadPdf'), hint: '只下载 OA 链接；不做任何绕过', checked: rd.downloadPdf, onChange: (v) => update((d) => { d.reading.downloadPdf = v }) }),
        h(SwitchRow, { label: t('downloadFigures'), hint: t('downloadFiguresHint'), checked: rd.downloadFigures, onChange: (v) => update((d) => { d.reading.downloadFigures = v }) }),
        h(TextRow, { label: t('maxFigures'), hint: '0–30；图片多时只取前 N 张', type: 'number', value: rd.maxFigures, onChange: (v) => update((d) => { d.reading.maxFigures = v }) }),
        h(SwitchRow, { label: t('dbEnrich'), hint: t('dbEnrichHint'), checked: rd.enrichDatabases, onChange: (v) => update((d) => { d.reading.enrichDatabases = v }) }),
        h(SwitchRow, { label: t('pubtator'), hint: t('pubtatorHint'), checked: rd.usePubtator !== false, onChange: (v) => update((d) => { d.reading.usePubtator = v }) }),
        h(TextRow, { label: t('dbMaxEntities'), hint: t('dbMaxEntitiesHint'), type: 'number', value: rd.maxEntities, onChange: (v) => update((d) => { d.reading.maxEntities = v }) }),
        h(TextRow, { label: t('keepPdf'), hint: '0 = 不自动清理（目前不自动清理，留作以后）', type: 'number', value: rd.keepPdfDays, onChange: (v) => update((d) => { d.reading.keepPdfDays = v }) }),

        h('div', { className: 'sci-group' }, t('privacy')),
        h(SwitchRow, { label: t('redactQueries'), hint: t('redactQueriesHint'), checked: cfg.privacy?.redactQueries, onChange: (v) => update((d) => { d.privacy.redactQueries = v }) }),
        h(SwitchRow, { label: t('logQueries'), hint: t('logQueriesHint'), checked: cfg.privacy?.logQueries, onChange: (v) => update((d) => { d.privacy.logQueries = v }) }),

        h('div', { className: 'sci-actions' },
          h('button', { className: 'sci-btn', disabled: busy === 'save', onClick: save }, busy === 'save' ? t('saving') : t('save')),
          h('button', { className: 'sci-btn sci-btn2', disabled: busy === 'deps', onClick: runDeps }, busy === 'deps' ? t('depsRunning') : t('deps')),
          h('button', { className: 'sci-btn sci-btn2', onClick: reload }, t('reload'))),

        error ? h('div', { className: 'sci-err' }, error) : null,
        notice ? h('div', { className: 'sci-ok' }, notice) : null,
        h('div', { className: 'sci-hint', style: { marginTop: 6 } }, t('runHint')),

        deps ? h('div', null,
          h('div', { className: 'sci-group' }, t('deps')),
          h('div', { className: deps.ok ? 'sci-ok' : 'sci-err' }, deps.ok ? t('depsOk') : t('depsFail')),
          h('div', { className: 'sci-out' }, (deps.items ?? []).map((i) => `${i.ok ? '✓' : '✗'} ${i.name}：${i.detail}${i.fix ? `\n    → ${i.fix}` : ''}`).join('\n') || deps.detail || deps.error || '')) : null,

        h('div', { className: 'sci-details' },
          h('details', null,
            h('summary', null, t('brief')),
            brief ? h('div', { className: 'sci-brief' }, brief.text) : h('div', { className: 'sci-hint' }, t('noBrief')))),

        h('div', { className: 'sci-group' }, t('advanced')),
        h(Row, { label: t('dataDir'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.dataDir ?? '—')),
        h(Row, { label: t('configFile'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.configFile ?? '—')),
        h(Row, { label: t('nodePath'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.nodePath ?? '—')),
        h(Row, { label: t('session'), readOnly: true }, h('span', { className: 'sci-hint' }, status?.sessionId ?? 'dsh-sci')),

        pendingClose ? h('div', { className: 'sci-modal' },
          h('div', { className: 'sci-modal-box' },
            h('div', { className: 'sci-modal-title' }, t('unsavedTitle')),
            h('p', { className: 'sci-hint' }, t('unsavedBody')),
            h('div', { className: 'sci-actions' },
              h('button', { className: 'sci-btn', disabled: busy === 'save-close', onClick: async () => {
                setBusy('save-close')
                const ok = await save()
                setBusy('')
                if (ok) { setPendingClose(false); closeUi() }
              } }, t('saveAndClose')),
              h('button', { className: 'sci-btn sci-btn2', onClick: () => {
                setDirty(false); dirtyRef.current = false; setPendingClose(false); closeUi()
              } }, t('discardClose')),
              h('button', { className: 'sci-btn sci-btn2', onClick: () => setPendingClose(false) }, t('cancel'))))) : null,
      )
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('dsh-sci', 'zh', ZH), 'dsh-sci: locale zh')
        ctx.effect(() => ctx.locale.register('dsh-sci', 'en', EN), 'dsh-sci: locale en')
        const t = ctx.locale.bind('dsh-sci')
        ctx.effect(() => installNavIcon(() => t('nav')), 'dsh-sci: settings nav icon')
        ctx.effect(
          () => ctx.slots.inject('settings.section', () => ctx.slots.register(
            { name: 'settings.section', id: 'sci', order: 7, label: () => t('nav') },
            (props) => h(Section, { ...props, t, pickDirectory: () => ctx.uiWorkspace.pickDirectory() }),
          )),
          'dsh-sci: settings section',
        )
      },
    }
  },
})
