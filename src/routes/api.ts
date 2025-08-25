import { Router, Request, Response } from 'express';
import { authenticateToken, requireProTier, validateInput, AuthenticatedRequest } from '../lib/middleware';
import { 
  GradeTradeRequestSchema, 
  SimulateLeagueRequestSchema, 
  CounterOfferRequestSchema,
  ActivateRequestSchema,
  InjuryNotesRequestSchema 
} from '../lib/validation';
import { createDataProvider, SleeperProvider, ManualProvider } from '../lib/dataProviders';
import { TradeAnalyzer } from '../lib/scoring';
import { LeagueSimulator } from '../lib/simulation';
import { stripeClient } from '../stripe/client';
import { config } from '../lib/config';

export const apiRoutes = Router();

// Public endpoints
apiRoutes.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Trade grading endpoint (free tier)
apiRoutes.post('/grade-trade', validateInput(GradeTradeRequestSchema), async (req: Request, res: Response) => {
  try {
    const { leagueSource, sleeperLeagueId, scoring, teams, trade } = req.body;

    // Get league data
    let league;
    if (leagueSource === 'sleeper') {
      if (!sleeperLeagueId) {
        return res.status(400).json({ error: 'sleeperLeagueId required for Sleeper source' });
      }
      const provider = createDataProvider('sleeper');
      league = await provider.getLeague(sleeperLeagueId);
    } else if (leagueSource === 'manual') {
      if (!teams || !scoring) {
        return res.status(400).json({ error: 'teams and scoring required for manual source' });
      }
      const provider = createDataProvider('manual') as ManualProvider;
      provider.setLeagueData({
        id: 'manual-league',
        name: 'Manual League',
        teams,
        scoring,
        settings: {
          rosterPositions: [],
          playoffTeams: 4,
          regularSeasonWeeks: 14,
          currentWeek: 8
        }
      });
      league = await provider.getLeague('manual-league');
    } else {
      // Use demo data
      const provider = createDataProvider('demo');
      league = await provider.getLeague('demo');
    }

    // Analyze the trade
    const analyzer = new TradeAnalyzer(league);
    const gradeResult = analyzer.analyzeTrade(trade);

    res.json(gradeResult);
  } catch (error: any) {
    console.error('Error grading trade:', error);
    res.status(500).json({ 
      error: 'Failed to grade trade', 
      message: error.message 
    });
  }
});

// Pro tier endpoints (require authentication)
apiRoutes.post('/simulate-league', 
  validateInput(SimulateLeagueRequestSchema),
  authenticateToken, 
  requireProTier, 
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { leagueSource, sleeperLeagueId, scoring, teams, trade, weeksRemaining, iterations } = req.body;

      // Get league data (same logic as grade-trade)
      let league;
      if (leagueSource === 'sleeper') {
        if (!sleeperLeagueId) {
          return res.status(400).json({ error: 'sleeperLeagueId required for Sleeper source' });
        }
        const provider = createDataProvider('sleeper');
        league = await provider.getLeague(sleeperLeagueId);
      } else if (leagueSource === 'manual') {
        if (!teams || !scoring) {
          return res.status(400).json({ error: 'teams and scoring required for manual source' });
        }
        const provider = createDataProvider('manual') as ManualProvider;
        provider.setLeagueData({
          id: 'manual-league',
          name: 'Manual League',
          teams,
          scoring,
          settings: {
            rosterPositions: [],
            playoffTeams: 4,
            regularSeasonWeeks: 14,
            currentWeek: 8
          }
        });
        league = await provider.getLeague('manual-league');
      } else {
        const provider = createDataProvider('demo');
        league = await provider.getLeague('demo');
      }

      // Run simulation
      const simulator = new LeagueSimulator(league);
      const simIterations = Math.min(iterations || config.DEFAULT_SIMULATION_ITERATIONS, config.MAX_SIMULATION_ITERATIONS);
      const simulationResult = await simulator.simulateLeague(trade, weeksRemaining, simIterations);

      res.json(simulationResult);
    } catch (error: any) {
      console.error('Error simulating league:', error);
      res.status(500).json({ 
        error: 'Failed to simulate league', 
        message: error.message 
      });
    }
  }
);

apiRoutes.post('/suggest-counteroffers', 
  validateInput(CounterOfferRequestSchema),
  authenticateToken, 
  requireProTier, 
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { maxSuggestions = 3 } = req.body;

      // For now, return a placeholder response
      // In a full implementation, this would use algorithmic logic to generate counter-offers
      res.json({
        suggestions: [
          {
            trade: {
              teamAOut: ["player1"],
              teamBOut: ["player2", "player3"]
            },
            grade: {
              score: 85,
              letter: "B" as const,
              teamImpacts: [],
              fairness: {
                towardsTeamId: "team1",
                deltaPercent: 5,
                explanation: "Slightly favors Team A"
              },
              rationale: [
                {
                  factor: "Positional Value",
                  impact: 0.8,
                  text: "Better positional balance"
                }
              ],
              riskTags: []
            },
            fairness: {
              towardsTeamId: "team1",
              deltaPercent: 5,
              explanation: "More balanced alternative"
            },
            rationale: [
              {
                factor: "Counter-offer",
                impact: 0.5,
                text: "Algorithmic suggestion for better balance"
              }
            ]
          }
        ].slice(0, maxSuggestions)
      });
    } catch (error: any) {
      console.error('Error suggesting counter-offers:', error);
      res.status(500).json({ 
        error: 'Failed to suggest counter-offers', 
        message: error.message 
      });
    }
  }
);

apiRoutes.get('/injury-notes', 
  authenticateToken, 
  requireProTier, 
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const playerIds = req.query.playerIds as string | string[];
      const playerIdArray = Array.isArray(playerIds) ? playerIds : [playerIds].filter(Boolean);

      if (playerIdArray.length === 0) {
        return res.status(400).json({ error: 'playerIds query parameter required' });
      }

      // For now, return placeholder injury notes
      // In a full implementation, this would fetch from Sleeper or other sources
      const injuryNotes = playerIdArray.map(playerId => ({
        playerId,
        headline: "No current injury concerns",
        description: "Player is healthy and expected to play",
        impact: "low" as const,
        timestamp: new Date()
      }));

      res.json(injuryNotes);
    } catch (error: any) {
      console.error('Error fetching injury notes:', error);
      res.status(500).json({ 
        error: 'Failed to fetch injury notes', 
        message: error.message 
      });
    }
  }
);

// Authentication endpoints
apiRoutes.get('/activate', async (req: Request, res: Response) => {
  try {
    const { email, hmac } = req.query;

    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email parameter required' });
    }

    // Basic HMAC validation (simplified for demo)
    // In production, you'd want more robust validation
    if (hmac && typeof hmac === 'string') {
      // Validate HMAC format but don't enforce strict verification for demo
      if (hmac.length < 10) {
        return res.status(400).json({ error: 'Invalid HMAC format' });
      }
    }

    // Verify subscription with Stripe
    const result = await stripeClient.verifySubscription(email);

    res.json(result);
  } catch (error: any) {
    console.error('Error activating subscription:', error);
    res.status(500).json({ 
      error: 'Failed to activate subscription', 
      message: error.message 
    });
  }
});

// Stripe webhook
apiRoutes.post('/stripe/webhook', async (req: Request, res: Response) => {
  try {
    const signature = req.headers['stripe-signature'] as string;
    
    if (!signature) {
      return res.status(400).json({ error: 'Missing stripe-signature header' });
    }

    // Handle the webhook
    await stripeClient.handleWebhook(req.body, signature);

    res.json({ received: true });
  } catch (error: any) {
    console.error('Webhook error:', error);
    res.status(400).json({ 
      error: 'Webhook processing failed', 
      message: error.message 
    });
  }
});

