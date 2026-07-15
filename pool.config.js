/*
 * POOL BUILDER — LOGIC CONFIGURATION
 * ================================================================
 * Edit this file to change weights, thresholds, and rules.
 * Weights are normalized automatically and do not need to add up to 100.
 */
window.POOL_BUILDER_CONFIG = {
  version: '3.0.1',

  /* 1. DATA SELECTION --------------------------------------------------- */
  dataSelection: {
    // Q75: the 25% of champions with the most role matches form the Rigorous set.
    rigorousQuantile: 0.75,

    // 'all' evaluates the entire role; 'rigorous' evaluates only the Rigorous set.
    // Mixed-population weighting is intentionally unavailable: choose one explicit
    // evaluation population so the configured scope has an unambiguous meaning.
    evaluationOpponents: 'rigorous',

    // 'rigorous-first' ranks statistically robust candidates first and uses the
    // remaining role champions only when needed to fill the recommendation list.
    recommendationCandidates: 'rigorous-first'
  },

  /* 2. MATCHUP MODEL ---------------------------------------------------- */
  matchup: {
    neutralWinrate: 0.50,

    // Direct matchup WR plus performance relative to the champion's usual WR.
    rawScoreWeights: {
      directWinrate: 70,
      relativeToGeneral: 30
    },

    // Bayesian-style pull toward 50% for small direct samples.
    shrinkageGames: 25,

    // Evidence and opponent popularity are intentionally sub-linear to prevent
    // common matchups from erasing rare but strategically important weaknesses.
    evidenceWeightExponent: 0.45,
    opponentLikelihoodExponent: 0.35,

    coverageBlendWeights: {
      evidenceWeighted: 45,
      opponentBalanced: 35,
      worstTail: 20
    },

    // Draft weaknesses are tail-driven: a rational opponent can target the gap.
    weaknessBlendWeights: {
      evidenceWeighted: 25,
      worstTail: 75
    },

    worstTailShare: 0.15,

    // Weakness-control calibration. Scores at or below 40% receive 0; a robust
    // answer at 52% or above receives 100. A neutral 50% answer is not perfect.
    weaknessScoreFloor: 0.40,
    weaknessScoreFullAt: 0.52,

    // Missing matchups are never inserted as fake rows. Instead, optimistic pool
    // aggregates are conservatively pulled toward this prior according to the
    // percentage of opponents for which a valid answer exists.
    unknownMatchupScore: 0.48,
    completenessShrinkExponent: 1.0,

    // Thresholds used in recommendation explanations.
    improvementMinDelta: 0.005,
    weakBelow: 0.48,
    fixedAbove: 0.52
  },

  /* 3. INDIVIDUAL CHAMPION STRENGTH ----------------------------------- */
  championStrength: {
    winrateFloor: 0.45,
    winrateCeiling: 0.55,

    automaticFirstPickWeights: {
      strength: 80,
      confidence: 20
    }
  },

  /* 4. PROFILE DIVERSITY ------------------------------------------------ */
  profileDiversity: {
    // Effectiveness is deliberately excluded. Correlated CC fields were reduced
    // to avoid counting the same stylistic signal twice.
    fields: [
      'avg_damage_to_champs',
      'avg_time_ccing_others',
      'vision_score',
      'goldxp_auc',
      'avg_level6_minute',
      'avg_kills_0_15m',
      'avg_bounty_net_0_15m'
    ],
    minimumComparableFields: 4,
    missingDistancePrior: 0.18,
    unknownPoolScore: 20
  },

  /* 5. DAMAGE CLASSIFICATION AND VARIETY ------------------------------- */
  damage: {
    specialistShareMin: 0.60,
    specialistGapMin: 0.20,
    meaningfulSecondaryShare: 0.35,
    trueDamageRelevantShare: 0.20,

    varietyScores: {
      physicalAndMagic: 100,
      physicalMagicAndTrue: 100,
      specialistAndHybrid: 80,
      hybridOnly: 55,
      singleSpecialistWithSecondary: 55,
      singleSpecialist: 25
    },

    trueDamageBonus: 10,
    unknownDataMaxPenalty: 0.40
  },

  /* 6. STATISTICAL RELIABILITY ----------------------------------------- */
  confidence: {
    // Absolute profile volume prevents a very small role sample from becoming
    // "fully reliable" merely because it reaches that role's relative Q75.
    profileSampleTarget: 500,
    matchupSampleTarget: 30,

    championWeights: {
      profileGames: 30,
      profileCompleteness: 15,
      knownOpponents: 35,
      matchupSamples: 20
    },

    poolWeights: {
      selectedChampions: 55,
      matchupCompleteness: 45
    }
  },

  /* 7. NEXT-CHAMPION RECOMMENDATION ----------------------------------- */
  recommendation: {
    limit: 7,

    // The actual projected change in final pool score is the principal signal.
    weights: {
      projectedPoolGain: 48,
      matchupComplement: 34,
      strength: 4,
      damageImprovement: 4,
      profileDiversity: 5,
      confidence: 5
    },

    matchupComplementWeights: {
      coverageGain: 55,
      weaknessGain: 45
    },

    fullMatchupGainAt: 0.035,
    fullPoolScoreGainAt: 10,
    fullDamageGainAt: 60,

    // Relative rank only modulates a positive absolute signal; it can no longer
    // create points when every candidate has zero absolute improvement.
    relativeRankBlend: 0.20,

    diversityHigh: 0.35,
    diversityLow: 0.16,
    knownOpponentWarningRatio: 0.65
  },

  /* 8. FINAL POOL EVALUATION ------------------------------------------- */
  poolEvaluation: {
    weights: {
      matchupCoverage: 42,
      weaknessControl: 28,
      averageChampionStrength: 8,
      damageVariety: 8,
      profileDiversity: 5,
      dataConfidence: 9
    },

    // Additional reliability multiplier applied after the weighted score.
    // At zero confidence the score retains 88% of its raw value; at full
    // confidence it is unchanged. Matchup aggregates already receive a separate
    // completeness adjustment, so this multiplier remains deliberately moderate.
    confidenceMultiplierFloor: 0.88,

    labels: [
      { min: 88, text: 'Highly complete pool' },
      { min: 75, text: 'Robust pool' },
      { min: 60, text: 'Functional pool with some gaps' },
      { min: 45, text: 'Limited or redundant pool' },
      { min: 0, text: 'Highly incomplete pool' }
    ]
  },

  /* 9. BAN RECOMMENDATION ---------------------------------------------- */
  banRecommendation: {
    limit: 10,
    maxLimit: 30,
    candidateQuantile: 0.50,

    // Matchup danger is dominant. Popularity is an intrinsic measure of how
    // often the candidate is encountered in the role; its smaller final weight
    // prevents it from overpowering a true matchup threat.
    weights: {
      matchupThreat: 60,
      popularity: 30,
      snowball: 10
    },

    matchupWeights: {
      directWinrate: 55,
      relativeToGeneral: 45
    },

    poolThreatWeights: {
      bestAnswerThreat: 50,
      averagePressure: 25,
      worstExposure: 25
    },

    shrinkageGames: 40,
    neutralThreat: 0.50,
    fullThreatAt: 0.60,
    unknownThreatPrior: 0.50,

    // Popularity combines rank within the role with actual match volume.
    // The old logarithmic scale compressed low and high volumes too much.
    // relativeVolume is measured against the role's Q95 match count and then
    // shaped with an exponent above 1, so lightly played champions remain
    // clearly separated from genuinely common picks without letting one
    // extreme outlier define the whole scale.
    popularityWeights: {
      percentile: 50,
      relativeVolume: 50
    },
    popularityReferenceQuantile: 0.50,
    popularityVolumeExponent: 1.50,

    // Snowball remains gated by matchup danger because volatility without
    // opponent pressure is not, by itself, a reason to ban the champion.
    snowballThreatGateFloor: 0.30,

    fullSnowballAt: 0.25,
    snowballWeights: {
      pressureWeightedAverage: 70,
      worstCase: 30
    },

    // The candidate is considered covered only when at least one known answer
    // keeps its adjusted threat at or below 52.5%.
    safeAnswerThreatMax: 0.525
  },

  /* 10. COUNTER TABLE --------------------------------------------------- */
  counterTable: {
    opponentQuantile: 0.50,
    defaultWilsonConfidence: 99
  },

  /* 11. INTERFACE ------------------------------------------------------- */
  ui: {
    smoothScroll: true,
    poolSizes: [2, 3, 4, 5],
    comboOptionLimit: 60
  }
};
