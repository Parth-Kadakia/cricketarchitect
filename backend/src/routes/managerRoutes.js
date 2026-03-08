import { Router } from 'express';
import { withTransaction } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import asyncHandler from '../utils/asyncHandler.js';
import {
  acceptManagerOffer,
  applyForManagerJob,
  declineManagerOffer,
  getManagerDirectory,
  getManagerProfile,
  getManagerCareerSnapshot,
  listManagerOffers,
  retireManagerCareer
} from '../services/managerCareerService.js';
import { getActiveSeason } from '../services/leagueService.js';

const router = Router();

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const snapshot = await getManagerCareerSnapshot(req.user.id, undefined, req.user.active_world_id || null);
    return res.json(snapshot);
  })
);

router.get(
  '/directory',
  requireAuth,
  asyncHandler(async (req, res) => {
    const seasonId = Number(req.query.seasonId || 0) || null;
    const mode = req.query.mode ? String(req.query.mode) : null;
    const limit = Number(req.query.limit || 220);
    const worldId = req.user?.active_world_id || null;
    const activeSeason = seasonId ? null : await getActiveSeason(undefined, worldId);
    const rows = await getManagerDirectory({
      seasonId: seasonId || activeSeason?.id || null,
      mode: mode || req.user?.career_mode || null,
      worldId,
      limit
    });
    return res.json({ managers: rows });
  })
);

router.get(
  '/profile/:managerId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const managerId = Number(req.params.managerId || 0);
    if (!managerId) {
      return res.status(400).json({ message: 'Valid managerId is required.' });
    }
    const worldId = req.user?.active_world_id || null;
    const profile = await getManagerProfile(managerId, undefined, worldId);
    if (!profile) {
      return res.status(404).json({ message: 'Manager not found.' });
    }
    return res.json(profile);
  })
);

router.get(
  '/offers',
  requireAuth,
  asyncHandler(async (req, res) => {
    const offers = await listManagerOffers(req.user.id, undefined, req.user.active_world_id || null);
    return res.json({ offers });
  })
);

router.post(
  '/offers/:offerId/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const snapshot = await withTransaction((client) =>
      acceptManagerOffer({
        userId: req.user.id,
        offerId: req.params.offerId,
        worldId: req.user.active_world_id || null,
        dbClient: client
      })
    );

    return res.json(snapshot);
  })
);

router.post(
  '/offers/:offerId/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const offers = await withTransaction((client) =>
      declineManagerOffer({
        userId: req.user.id,
        offerId: req.params.offerId,
        worldId: req.user.active_world_id || null,
        dbClient: client
      })
    );

    return res.json({ offers });
  })
);

router.post(
  '/apply',
  requireAuth,
  asyncHandler(async (req, res) => {
    const franchiseId = Number(req.body?.franchiseId || 0);
    if (!franchiseId) {
      return res.status(400).json({ message: 'franchiseId is required.' });
    }

    const result = await withTransaction((client) =>
      applyForManagerJob({
        userId: req.user.id,
        franchiseId,
        worldId: req.user.active_world_id || null,
        dbClient: client
      })
    );

    return res.json(result);
  })
);

router.post(
  '/retire',
  requireAuth,
  asyncHandler(async (req, res) => {
    const snapshot = await withTransaction((client) =>
      retireManagerCareer({
        userId: req.user.id,
        worldId: req.user.active_world_id || null,
        dbClient: client
      })
    );

    return res.json(snapshot);
  })
);

export default router;
