/*
 * POOL BUILDER — LOGIC CONFIGURATION
 * ================================================================
 * THIS IS THE FILE TO EDIT to change weights, thresholds, and rules.
 *
 * Important rule: the weights do NOT have to add up to 100.
 * The engine normalizes them automatically. You can therefore use
 * intuitive values such as 50 / 20 / 15 / 10 / 5.
 */
window.POOL_BUILDER_CONFIG = {
  version: '2.2.0',

  /* 1. WHICH CHAMPIONS ARE INCLUDED IN THE ANALYSIS ---------------------- */
  dataSelection: {
    // 0.75 = Q75: the 25% of champions with the most matches form the Rigorous group.
    rigorousQuantile: 0.75,

    // 'all' = evaluates coverage against the entire lane.
    // 'rigorous' = evaluates only against the Rigorous group.
    // 'blend' = mixes the two populations according to rigorousBlendWeight.
    // NOTE: 'blend' requires engine-side support — if the engine does not
    // implement it yet, this field must be treated as 'rigorous'.
    evaluationOpponents: 'blend',

    // Weight of the Rigorous group in the blend (0 = 'all' only, 1 = 'rigorous' only).
    // 0.6 = slight bias toward the more reliable data, while
    // retaining a substantial contribution from the entire lane.
    rigorousBlendWeight: 0.6,

    // 'rigorous-first' = recommends Rigorous champions first and uses the others
    // only to complete the list. 'all' = treats everyone equally.
    recommendationCandidates: 'rigorous-first'
  },

  /* 2. SINGLE MATCHUP SCORE --------------------------- */
  matchup: {
    neutralWinrate: 0.50,

    // Formula base del matchup:
    // - directWinrate: actual WR in the direct matchup;
    // - relativeToGeneral: performance in the matchup relative to overall WR.
    rawScoreWeights: {
      directWinrate: 70,
      relativeToGeneral: 30
    },

    // The higher it is, the more matchups with few matches are pulled toward 50%.
    // 0 disables statistical shrinkage.
    shrinkageGames: 20,

    // Match weighting in averages: 1 = linear, 0.5 = square root,
    // 0 = every matchup has equal weight. 0.5 prevents the most popular matchups
    // from completely erasing rarer weaknesses.
    evidenceWeightExponent: 0.5,

    // NEW: how much the actual probability of encountering an opponent matters
    // (based on how many total matches they have played in that lane) when
    // calculating coverage and weaknesses. 0 = ignores popularity; every opponent
    // has equal weight. 1 = linear popularity weighting. 0.6 is a middle ground:
    // common opponents matter more than extremely rare ones, but a rare hard counter
    // does not disappear entirely from the calculation.
    opponentLikelihoodExponent: 0.6,

    // Final matchup coverage: combines the weighted average, opponent-balanced average,
    // and worst tail. The weights are normalized automatically.
    coverageBlendWeights: {
      evidenceWeighted: 50,
      opponentBalanced: 25,
      worstTail: 25
    },

    // Weakness control: unlike coverage (which reflects the
    // expected value over many matches, from an analyst's perspective), the
    // worst tail dominates here. Philosophy: a rational opponent in draft will find and
    // exploit your weak point even if it is rare in the historical data — a
    // pro player/game theorist does not trust the average for this purpose.
    weaknessBlendWeights: {
      evidenceWeighted: 40,
      worstTail: 60
    },

    // 0.15 = treats 15% of known matchups as the "worst tail."
    // Deliberately narrow: now that weaknessBlendWeights prioritizes the tail
    // (see above), we want it to capture the real threats, not also
    // mediocre-but-not-disastrous matchups.
    worstTailShare: 0.15,

    // Thresholds used in recommendation explanations.
    improvementMinDelta: 0.005,
    weakBelow: 0.48,
    fixedAbove: 0.52
  },

  /* 3. INDIVIDUAL CHAMPION STRENGTH ---------------------------- */
  championStrength: {
    // WR is transformed linearly into a 0–100 score.
    // 45% or less = 0; 55% or more = 100.
    winrateFloor: 0.45,
    winrateCeiling: 0.55,

    // Automatic first pick: balance between strength and reliability.
    automaticFirstPickWeights: {
      strength: 80,
      confidence: 20
    }
  },

  /* 4. PROFILE DIVERSITY ------------------------------------- */
  profileDiversity: {
    // Add or remove fields to decide what "different style" means.
    // Overall WR is deliberately excluded: it measures effectiveness, not style.
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

  /* 5. DAMAGE CLASSIFICATION AND VARIETY ----------------------- */
  damage: {
    specialistShareMin: 0.60,
    specialistGapMin: 0.20,
    meaningfulSecondaryShare: 0.35,
    trueDamageRelevantShare: 0.20,

    // Scores assigned to the different damage compositions.
    varietyScores: {
      physicalAndMagic: 100,
      physicalMagicAndTrue: 100,
      specialistAndHybrid: 80,
      hybridOnly: 60,
      singleSpecialistWithSecondary: 60,
      singleSpecialist: 30
    },

    // Additive bonus (0–100) applied when the pool has at least one champion
    // with meaningful true damage, added to the base variety score before
    // the final clamp. True damage is rare and difficult to itemize
    // against: a pro player considers it a real draft advantage.
    trueDamageBonus: 10,

    // Maximum penalty when part of the pool lacks damage data.
    // With all data missing, the score still remains 0.
    unknownDataMaxPenalty: 0.35
  },

  /* 6. STATISTICAL RELIABILITY ----------------------------------- */
  confidence: {
    // Number of direct matches required for the statistical sample
    // of a single matchup to be considered full.
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

  /* 7. NEXT-CHAMPION RECOMMENDATION --------------------- */
  recommendation: {
    limit: 7,

    weights: {
      matchupComplement: 63,
      strength: 6,
      damageImprovement: 9,
      profileDiversity: 14,
      confidence: 8
    },

    // How the matchup-complementarity value is constructed.
    matchupComplementWeights: {
      coverageGain: 60,
      weaknessGain: 40
    },

    // A gain of 0.035 equals +3.5 percentage points and is worth 100
    // in the matchup component. Increase it to make the system stricter.
    fullMatchupGainAt: 0.035,

    // Increase in damage variety (on a 0–100 scale) required to obtain
    // 100 in the corresponding component.
    fullDamageGainAt: 70,

    // 0 = completely absolute score; 1 = completely relative to the
    // other candidates. 0.35 avoids very high ratings when everyone improves little.
    relativeRankBlend: 0.35,

    diversityHigh: 0.35,
    diversityLow: 0.16,
    knownOpponentWarningRatio: 0.60
  },

  /* 8. FINAL POOL EVALUATION ----------------------------- */
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
      { min: 85, text: 'Highly complete pool' },
      { min: 70, text: 'Robust pool' },
      { min: 55, text: 'Functional pool with some gaps' },
      { min: 40, text: 'Limited or redundant pool' },
      { min: 0, text: 'Highly incomplete pool' }
    ]
  },

  /* 9. BAN RECOMMENDATION ---------------------------------------- */
  banRecommendation: {
    // Maximum number of suggestions shown initially.
    limit: 10,

    // Matchup risk remains the dominant component. Popularity and
    // snowballing mainly help separate threats with similar risk.
    weights: {
      matchupThreat: 30,
      popularity: 50,
      snowball: 10
    },

    // Primary risk combines the opponent's direct WR and performance
    // relative to their overall WR in the specific matchup.
    matchupWeights: {
      directWinrate: 50,
      relativeToGeneral: 50
    },

    // With a complete pool, what matters most is whether at least one safe
    // answer exists. The average and worst matchup nevertheless keep the pressure
    // exerted on the rest of the pool visible.
    poolThreatWeights: {
      noSafeAnswer: 40,
      averagePressure: 20,
      worstExposure: 40
    },

    // Pulls direct matchups with few matches toward 50%.
    shrinkageGames: 40,

    // Converts aggregate risk to a 0–100 scale: 50% is neutral,
    // 60% or more equals a full matchup threat.
    neutralThreat: 0.50,
    fullThreatAt: 0.60,

    // Actual popularity of the potential ban in the role. The percentile prevents
    // a few enormously popular champions from overwhelming all others; the
    // logarithmic component preserves the distance between heavily and lightly played champions.
    popularityWeights: {
      percentile: 50,
      logarithmic: 50
    },

    // 25 percentage points of ahead/behind sensitivity are worth 100 in the
    // snowball component. The worst value weighs less than the risk-oriented average
    // across matchups where the opponent is already dangerous.
    fullSnowballAt: 0.25,
    snowballWeights: {
      pressureWeightedAverage: 70,
      worstCase: 30
    },

    // A pool is "Covered" against the potential ban if at least one of its
    // champions keeps the opponent's adjusted threat at 55% or less.
    // Lower it to require a more clearly favorable answer.
    safeAnswerThreatMax: 0.55,

    // Completely excludes a potential ban when the matchup with the greatest
    // snowball sensitivity still favors the pool on both
    // signals: opponent's direct WR <= 50% and WR difference <= 0.
    // If either value is missing, the candidate is not excluded.
    excludeIfMostSensitiveFavorsPool: true,
    favorableSensitiveMaxWinrate: 0.50,
    favorableSensitiveMaxDiff: 0
  },

  /* 10. INTERFACCIA ----------------------------------------------- */
  ui: {
    smoothScroll: true
  }
};