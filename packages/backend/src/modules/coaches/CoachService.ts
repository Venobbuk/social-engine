/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Inject, Injectable } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DI } from '@/di-symbols.js';
import { bindThis } from '@/decorators.js';
import { IdService } from '@/core/IdService.js';
import { RoleService } from '@/core/RoleService.js';
import { NotificationService } from '@/core/NotificationService.js';
import { UserEntityService } from '@/core/entities/UserEntityService.js';
import { IdentifiableError } from '@/misc/identifiable-error.js';
import type { MiUser } from '@/models/User.js';
import { isGripbatStaff, gripbatStaffIds } from '@/modules/staff.js';

/*
 * COACH-VERIFY-V1 (NUKE-REVIEW-FIXES-V1, review finding 3) — the door that was missing from NUKE-COACH-V1.
 *
 * NUKE-COACH-V1 is right that "is a coach" is the NATIVE role arc5w1aagbcoach1 and that the details are the NATIVE
 * profile fields. What it shipped without is a GRANTOR: admin/roles/assign is requireModerator:true and the GripBat
 * staff role is deliberately plain (modules/staff.ts), so the copy "GripBat staff verify coaches" could not come true
 * and every applicant waited for ever.
 *
 * This service is the same shape as CLUB-CLAIM-VERIFY-V1 (ClubService.claim / claimsList / claimsDecide) and reuses
 * its auth model exactly — isGripbatStaff, the NOT_GRIPBAT_STAFF 403, the staff notification, the applicant
 * notification after the decision, the cooldown after a decline. The verdict is written through the NATIVE
 * RoleService.assign / unassign (G11 rule 2: extend the native path, do not rebuild roles); coach_claim records only
 * the application and the answer, which a role assignment cannot express.
 */

/** The same fixed id the migration creates and the app names (lib/discover.ts COACH_ROLE_ID). */
export const COACH_ROLE_ID = 'arc5w1aagbcoach1';
/** After a decline the same person may apply again only after this (CLAIM_COOLDOWN_DAYS, clubs). */
export const COACH_COOLDOWN_DAYS = 7;
/** The three native profile fields NUKE-COACH-V1 put the details in (i/update { fields }). */
export const COACH_FIELD_NAMES = { experience: 'Coaching experience', rate: 'Coaching rate', notes: 'Coaching notes' } as const;

export type CoachDetails = { experience: string | null; rate: string | null; notes: string | null };
export type CoachApplication = {
	status: 'none' | 'pending' | 'approved' | 'rejected';
	verified: boolean;
	claimId: string | null;
	createdAt: string | null;
	decidedAt: string | null;
	/** ISO date the applicant may apply again after a decline, else null. */
	retryAfter: string | null;
	details: CoachDetails;
};

type ClaimRow = { id: string; userId: string; status: string; createdAt: Date; decidedAt: Date | null };

@Injectable()
export class CoachService {
	constructor(
		@Inject(DI.db) private db: DataSource,
		private idService: IdService,
		private roleService: RoleService,
		private notificationService: NotificationService,
		private userEntityService: UserEntityService,
	) {}

	private err(id: string, message: string): IdentifiableError { return new IdentifiableError(`coach:${id}`, message); }

	private notify(userId: string, header: string, body: string): void {
		this.notificationService.createNotification(userId, 'app', { customHeader: header, customBody: body, customIcon: null, appAccessTokenId: null, customLink: 'coach:' + userId });
	}

	/** Holds the native Coach role right now (an expired assignment does not count) — the ONE source of "is a coach". */
	@bindThis
	public async holdsCoachRole(userId: string): Promise<boolean> {
		const rows = await this.db.query(`SELECT 1 FROM "role_assignment" WHERE "roleId" = $1 AND "userId" = $2 AND ("expiresAt" IS NULL OR "expiresAt" > now()) LIMIT 1`, [COACH_ROLE_ID, userId]) as unknown[];
		return rows.length > 0;
	}

	/** The three native profile fields, read straight off user_profile (what i/update wrote, what users/show returns). */
	@bindThis
	public async details(userId: string): Promise<CoachDetails> {
		const row = (await this.db.query(`SELECT "fields" FROM "user_profile" WHERE "userId" = $1`, [userId]) as { fields: { name?: string; value?: string }[] | null }[])[0];
		const fields = Array.isArray(row?.fields) ? row.fields : [];
		const pick = (name: string): string | null => {
			const f = fields.find(x => x && String(x.name ?? '').toLowerCase() === name.toLowerCase());
			const v = f ? String(f.value ?? '').trim() : '';
			return v.length > 0 ? v : null;
		};
		return { experience: pick(COACH_FIELD_NAMES.experience), rate: pick(COACH_FIELD_NAMES.rate), notes: pick(COACH_FIELD_NAMES.notes) };
	}

	private async latest(userId: string): Promise<ClaimRow | null> {
		const r = await this.db.query(`SELECT "id", "userId", "status", "createdAt", "decidedAt" FROM "coach_claim" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 1`, [userId]) as ClaimRow[];
		return r[0] ?? null;
	}

	/** My own coach application: what the player's screen shows instead of guessing from their profile fields. */
	@bindThis
	public async mine(userId: string): Promise<CoachApplication> {
		const [verified, details, k] = await Promise.all([this.holdsCoachRole(userId), this.details(userId), this.latest(userId)]);
		const status: CoachApplication['status'] = verified ? 'approved' : (k ? (k.status === 'approved' ? 'approved' : k.status === 'pending' ? 'pending' : 'rejected') : 'none');
		const retryAfter = (!verified && k && k.status === 'rejected' && k.decidedAt)
			? new Date(new Date(k.decidedAt).getTime() + COACH_COOLDOWN_DAYS * 86_400_000).toISOString()
			: null;
		return {
			status, verified,
			claimId: k?.id ?? null,
			createdAt: k ? new Date(k.createdAt).toISOString() : null,
			decidedAt: k?.decidedAt ? new Date(k.decidedAt).toISOString() : null,
			retryAfter,
			details,
		};
	}

	/** Ask GripBat staff to verify me. Idempotent: a pending application (or the role) is simply returned. */
	@bindThis
	public async apply(user: MiUser): Promise<CoachApplication> {
		if (await this.holdsCoachRole(user.id)) return await this.mine(user.id);
		const details = await this.details(user.id);
		if (!details.experience && !details.rate) throw this.err('no_details', 'Fill in your coaching experience or your rate first.');
		const k = await this.latest(user.id);
		if (k && k.status === 'pending') return await this.mine(user.id);
		if (k && k.status === 'rejected' && k.decidedAt && Date.now() < new Date(k.decidedAt).getTime() + COACH_COOLDOWN_DAYS * 86_400_000) {
			throw this.err('cooldown', `Your last application was declined. You can apply again after ${new Date(new Date(k.decidedAt).getTime() + COACH_COOLDOWN_DAYS * 86_400_000).toISOString().slice(0, 10)}.`);
		}
		const inserted = await this.db.query(`INSERT INTO "coach_claim" ("id", "userId") VALUES ($1, $2)
			ON CONFLICT ("userId") WHERE "status" = 'pending' DO NOTHING RETURNING "id"`, [this.idService.gen(), user.id]) as { id: string }[];
		if (inserted.length) {
			// staff hear about a NEW application once, exactly as they hear about a new club ownership claim
			for (const staffId of await gripbatStaffIds(this.db)) {
				if (staffId !== user.id) this.notifyStaff(staffId, user);
			}
		}
		return await this.mine(user.id);
	}

	private notifyStaff(staffId: string, applicant: MiUser): void {
		// 'coachq:' takes staff to the QUEUE that is asking them to act; 'coach:' takes the applicant to their own screen
		this.notificationService.createNotification(staffId, 'app', { customHeader: 'Coach verification', customBody: `${applicant.name ?? applicant.username} asked to be verified as a coach.`, customIcon: null, appAccessTokenId: null, customLink: 'coachq:' + applicant.id });
	}

	/** The staff queue. `status` 'pending' (default) is the work to do; 'approved' lists the verified coaches so staff
	 *  can take the role back from one. Same auth as clubs/claims/list. */
	@bindThis
	public async list(viewer: MiUser, status: 'pending' | 'approved' = 'pending', limit = 50) {
		if (!(await isGripbatStaff(this.db, viewer.id))) throw this.err('not_staff', 'Only GripBat staff can do this.'); // STAFF-ROLE-V1
		const rows = await this.db.query(`SELECT k."id", k."userId", k."status", k."createdAt", k."decidedAt"
			FROM "coach_claim" k WHERE k."status" = $1 ORDER BY k."createdAt" ASC LIMIT $2`, [status, limit]) as ClaimRow[];
		const out = [];
		for (const r of rows) {
			const details = await this.details(r.userId);
			out.push({
				id: r.id, userId: r.userId, status: r.status,
				createdAt: new Date(r.createdAt).toISOString(),
				decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
				verified: await this.holdsCoachRole(r.userId),
				experience: details.experience, rate: details.rate, notes: details.notes,
				user: await this.userEntityService.pack(r.userId, viewer, { schema: 'UserLite' }).catch(() => null),
			});
		}
		return out;
	}

	/** The staff decision. approve -> the NATIVE role is assigned; !approve -> declined, and if it had been approved the
	 *  role is taken back (the revoke half of the door). The applicant is told either way. */
	@bindThis
	public async decide(claimId: string, approve: boolean, staff: MiUser): Promise<{ status: string }> {
		if (!(await isGripbatStaff(this.db, staff.id))) throw this.err('not_staff', 'Only GripBat staff can do this.'); // STAFF-ROLE-V1
		const k = (await this.db.query(`SELECT "id", "userId", "status", "createdAt", "decidedAt" FROM "coach_claim" WHERE "id" = $1`, [claimId]) as ClaimRow[])[0];
		if (!k) throw this.err('no_such_claim', 'No such coach application.');
		if (k.status === 'rejected') throw this.err('claim_decided', 'This application was already decided.');
		if (k.status === 'approved' && approve) throw this.err('claim_decided', 'This application was already decided.');

		if (approve) {
			const account = (await this.db.query(`SELECT 1 FROM "user" u WHERE u."id" = $1 AND u."isSuspended" = false AND u."isDeleted" = false`, [k.userId]) as unknown[]).length > 0;
			if (!account) throw this.err('no_account', 'That account is gone or suspended. Decline this application.');
			// NATIVE grant — the same row admin/roles/assign writes, with the moderation-log entry and the role events
			await this.roleService.assign(k.userId, COACH_ROLE_ID, null, staff).catch((e: unknown) => {
				if (e instanceof RoleService.AlreadyAssignedError) return; // already a coach: the claim just catches up
				throw e;
			});
			await this.db.query(`UPDATE "coach_claim" SET "status" = 'approved', "decidedAt" = now(), "decidedById" = $2 WHERE "id" = $1`, [k.id, staff.id]);
			this.notify(k.userId, 'Coach verified', 'GripBat staff verified your coach profile. It now shows on your player page and in Discover.');
			return { status: 'approved' };
		}

		// NATIVE revoke — only if they actually hold it (a never-granted application just gets declined)
		await this.roleService.unassign(k.userId, COACH_ROLE_ID, staff).catch((e: unknown) => {
			if (e instanceof RoleService.NotAssignedError) return;
			throw e;
		});
		await this.db.query(`UPDATE "coach_claim" SET "status" = 'rejected', "decidedAt" = now(), "decidedById" = $2 WHERE "id" = $1`, [k.id, staff.id]);
		this.notify(k.userId, k.status === 'approved' ? 'Coach verification removed' : 'Coach verification declined', k.status === 'approved' ? 'GripBat staff removed the verified coach badge from your profile.' : 'GripBat staff declined your coach profile for now.');
		return { status: 'rejected' };
	}
}
