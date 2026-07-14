/*
 * POOL BUILDER — CONFIGURAZIONE DELLA LOGICA
 * ================================================================
 * QUESTO È IL FILE DA MODIFICARE per cambiare pesi, soglie e regole.
 *
 * Regola importante: i pesi NON devono per forza sommare a 100.
 * Il motore li normalizza automaticamente. Puoi quindi usare numeri
 * intuitivi come 50 / 20 / 15 / 10 / 5.
 */
window.POOL_BUILDER_CONFIG = {
  version: '2.2.0',

  /* 1. QUALI CAMPIONI ENTRANO NELLE ANALISI ---------------------- */
  dataSelection: {
    // 0.75 = Q75: il 25% dei campioni con più partite forma il gruppo Rigoroso.
    rigorousQuantile: 0.75,

    // 'all' = valuta la copertura contro tutta la lane.
    // 'rigorous' = valuta soltanto contro il gruppo Rigoroso.
    // 'blend' = miscela le due popolazioni secondo rigorousBlendWeight.
    // NB: 'blend' richiede supporto lato motore — se il motore non lo
    // implementa ancora, questo campo va trattato come 'rigorous'.
    evaluationOpponents: 'blend',

    // Peso del gruppo Rigoroso nel blend (0 = solo 'all', 1 = solo 'rigorous').
    // 0.6 = leggero sbilanciamento verso i dati più affidabili, pur
    // mantenendo un contributo sostanziale da tutta la lane.
    rigorousBlendWeight: 0.6,

    // 'rigorous-first' = consiglia prima i campioni Rigorosi e usa gli altri
    // soltanto per completare la lista. 'all' = tratta tutti allo stesso modo.
    recommendationCandidates: 'rigorous-first'
  },

  /* 2. PUNTEGGIO DI UN SINGOLO MATCHUP --------------------------- */
  matchup: {
    neutralWinrate: 0.50,

    // Formula base del matchup:
    // - directWinrate: WR effettivo nel confronto diretto;
    // - relativeToGeneral: rendimento nel matchup rispetto al WR generale.
    rawScoreWeights: {
      directWinrate: 70,
      relativeToGeneral: 30
    },

    // Più è alto, più i matchup con poche partite vengono avvicinati al 50%.
    // 0 disattiva lo shrinkage statistico.
    shrinkageGames: 20,

    // Peso delle partite nelle medie: 1 = lineare, 0.5 = radice quadrata,
    // 0 = ogni matchup pesa uguale. 0.5 evita che i matchup più popolari
    // cancellino completamente le debolezze più rare.
    evidenceWeightExponent: 0.5,

    // NUOVO: quanto conta la probabilità reale di incontrare un avversario
    // (basata su quante partite totali ha giocato in quella lane) quando si
    // calcola copertura e debolezze. 0 = ignora la popolarità, ogni avversario
    // pesa uguale. 1 = peso lineare sulla popolarità. 0.6 è una via di mezzo:
    // gli avversari comuni contano più di quelli rarissimi, ma un hard-counter
    // raro non sparisce del tutto dal calcolo.
    opponentLikelihoodExponent: 0.6,

    // Copertura finale dei matchup: combina media pesata, media per avversario
    // e coda peggiore. I pesi vengono normalizzati automaticamente.
    coverageBlendWeights: {
      evidenceWeighted: 50,
      opponentBalanced: 25,
      worstTail: 25
    },

    // Controllo debolezze: a differenza della copertura (che riflette il
    // valore atteso su tante partite, prospettiva analista), qui domina la
    // coda peggiore. Filosofia: un avversario razionale in draft trova e
    // sfrutta il tuo punto debole anche se è raro nello storico — un
    // proplayer/teorico dei giochi non si fida della media per questo scopo.
    weaknessBlendWeights: {
      evidenceWeighted: 40,
      worstTail: 60
    },

    // 0.15 = considera come "coda peggiore" il 15% dei matchup noti.
    // Ristretto apposta: ora che weaknessBlendWeights dà priorità alla coda
    // (vedi sopra), vogliamo che catturi le vere minacce, non anche i
    // matchup mediocri-ma-non-drammatici.
    worstTailShare: 0.15,

    // Soglie usate nelle spiegazioni delle raccomandazioni.
    improvementMinDelta: 0.005,
    weakBelow: 0.48,
    fixedAbove: 0.52
  },

  /* 3. FORZA INDIVIDUALE DEL CAMPIONE ---------------------------- */
  championStrength: {
    // Il WR viene trasformato linearmente in un punteggio 0–100.
    // 45% o meno = 0; 55% o più = 100.
    winrateFloor: 0.45,
    winrateCeiling: 0.55,

    // Primo pick automatico: equilibrio tra forza e affidabilità.
    automaticFirstPickWeights: {
      strength: 80,
      confidence: 20
    }
  },

  /* 4. DIVERSITÀ DEL PROFILO ------------------------------------- */
  profileDiversity: {
    // Aggiungi o rimuovi campi per decidere cosa significa "stile diverso".
    // Il WR generale è volutamente escluso: misura efficacia, non stile.
    fields: [
      'avg_damage_to_champs',
      'avg_time_ccing_others',
      'avg_total_time_cc_dealt',
      'vision_score',
      'goldxp_auc',
      'avg_level6_minute',
      'avg_kills_0_15m',
      'avg_bounty_net_0_15m'
    ]
  },

  /* 5. CLASSIFICAZIONE E VARIETÀ DEL DANNO ----------------------- */
  damage: {
    specialistShareMin: 0.60,
    specialistGapMin: 0.20,
    meaningfulSecondaryShare: 0.35,
    trueDamageRelevantShare: 0.20,

    // Punteggi assegnati alle diverse composizioni di danno.
    varietyScores: {
      physicalAndMagic: 100,
      physicalMagicAndTrue: 100,
      specialistAndHybrid: 80,
      hybridOnly: 60,
      singleSpecialistWithSecondary: 60,
      singleSpecialist: 30
    },

    // Bonus additivo (0-100) applicato quando la pool ha almeno un campione
    // con danno vero rilevante, sommato al punteggio base di varietà prima
    // del clamp finale. Il danno vero è raro e difficile da itemizzare
    // contro: un proplayer lo considera un vantaggio di draft reale.
    trueDamageBonus: 10,

    // Penalità massima quando parte della pool non possiede dati sul danno.
    // Con tutti i dati mancanti il punteggio resta comunque 0.
    unknownDataMaxPenalty: 0.35
  },

  /* 6. AFFIDABILITÀ STATISTICA ----------------------------------- */
  confidence: {
    // Numero di partite dirette necessario per considerare pieno il campione
    // statistico di un singolo matchup.
    matchupSampleTarget: 25,

    championWeights: {
      profileGames: 40,
      knownOpponents: 40,
      matchupSamples: 20
    },

    poolWeights: {
      selectedChampions: 60,
      matchupCompleteness: 40
    }
  },

  /* 7. RACCOMANDAZIONE DEL PROSSIMO CAMPIONE --------------------- */
  recommendation: {
    limit: 7,

    weights: {
      matchupComplement: 63,
      strength: 6,
      damageImprovement: 9,
      profileDiversity: 14,
      confidence: 8
    },

    // Come viene costruito il valore di complementarità matchup.
    matchupComplementWeights: {
      coverageGain: 60,
      weaknessGain: 40
    },

    // Un guadagno di 0.035 equivale a +3,5 punti percentuali e vale 100
    // nella componente matchup. Aumentalo per rendere il sistema più severo.
    fullMatchupGainAt: 0.035,

    // Aumento della varietà danno (su scala 0–100) necessario per ottenere
    // 100 nella relativa componente.
    fullDamageGainAt: 70,

    // 0 = punteggio completamente assoluto; 1 = completamente relativo agli
    // altri candidati. 0.35 evita voti altissimi quando tutti migliorano poco.
    relativeRankBlend: 0.35,

    diversityHigh: 0.35,
    diversityLow: 0.16,
    knownOpponentWarningRatio: 0.60
  },

  /* 8. VALUTAZIONE FINALE DELLA POOL ----------------------------- */
  poolEvaluation: {
    weights: {
      matchupCoverage: 48,
      weaknessControl: 22,
      averageChampionStrength: 8,
      damageVariety: 10,
      profileDiversity: 4,
      dataConfidence: 8
    },

    labels: [
      { min: 85, text: 'Pool molto completa' },
      { min: 70, text: 'Pool solida' },
      { min: 55, text: 'Pool funzionale con alcune lacune' },
      { min: 40, text: 'Pool limitata o ridondante' },
      { min: 0, text: 'Pool fortemente incompleta' }
    ]
  },

  /* 9. CONSIGLIO BAN --------------------------------------------- */
  banRecommendation: {
    // Numero massimo di suggerimenti mostrati inizialmente.
    limit: 10,

    // Il rischio matchup resta la componente dominante. Popolarità e
    // snowball servono soprattutto a separare minacce con rischio simile.
    weights: {
      matchupThreat: 30,
      popularity: 50,
      snowball: 10
    },

    // Il rischio primario combina WR diretto dell'avversario e rendimento
    // relativo al suo WR generale nello specifico matchup.
    matchupWeights: {
      directWinrate: 50,
      relativeToGeneral: 50
    },

    // Con una pool completa conta soprattutto se esiste almeno una risposta
    // sicura. Media e matchup peggiore mantengono però visibile la pressione
    // esercitata sul resto della pool.
    poolThreatWeights: {
      noSafeAnswer: 40,
      averagePressure: 20,
      worstExposure: 40
    },

    // Riduce verso il 50% i matchup diretti con poche partite.
    shrinkageGames: 40,

    // Trasforma il rischio aggregato in una scala 0-100: 50% è neutro,
    // 60% o più equivale a minaccia matchup piena.
    neutralThreat: 0.50,
    fullThreatAt: 0.60,

    // Popolarità reale del possibile ban nel ruolo. Il percentile evita che
    // pochi campioni enormemente popolari schiaccino tutti gli altri; la parte
    // logaritmica conserva la distanza tra campioni molto e poco giocati.
    popularityWeights: {
      percentile: 50,
      logarithmic: 50
    },

    // 25 punti percentuali di sensibilità avanti/indietro valgono 100 nella
    // componente snowball. Il valore peggiore pesa meno della media orientata
    // ai matchup in cui l'avversario è già pericoloso.
    fullSnowballAt: 0.25,
    snowballWeights: {
      pressureWeightedAverage: 70,
      worstCase: 30
    },

    // Una pool è "Coperta" contro il possibile ban se almeno uno dei suoi
    // campioni mantiene la minaccia corretta dell'avversario al 55% o meno.
    // Riducilo per richiedere una risposta più chiaramente favorevole.
    safeAnswerThreatMax: 0.55,

    // Esclude completamente un possibile ban quando il matchup con la maggiore
    // sensibilità allo snowball resta comunque favorevole alla pool su entrambi
    // i segnali: WR diretto dell'avversario <= 50% e WR diff <= 0.
    // Se uno dei due dati manca, il candidato non viene escluso.
    excludeIfMostSensitiveFavorsPool: true,
    favorableSensitiveMaxWinrate: 0.50,
    favorableSensitiveMaxDiff: 0
  },

  /* 10. INTERFACCIA ----------------------------------------------- */
  ui: {
    smoothScroll: true
  }
};