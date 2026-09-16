/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';

export const venueSources = ['league', 'community'] as const;
/** Reclub venue status (Verified / Under Review) + closed. */
export const venueStatuses = ['verified', 'under_review', 'closed'] as const;

/**
 * VENUE-V1 (W4, decision D13): Reclub's venue model — a Google place with a status and a staff-assigned owner,
 * no Court table — plus two-tier curation. A venue a league tenant curates (hkpl `Venue` rows, synced one way
 * through adapter/venues/sync) is `league` and Verified; a venue a player adds from Places autocomplete is
 * `community` and Under Review until staff verify it. Meets keep their own denormalised venueName/lat/lng.
 */
@Entity('venue')
@Index(['source', 'curatedByTenant', 'externalRef'], { unique: true, where: '"externalRef" IS NOT NULL' })
export class MiVenue {
	@PrimaryColumn(id())
	public id: string;

	@Column('varchar', { length: 256 })
	public name: string;

	@Column('varchar', { length: 512, nullable: true })
	public address: string | null;

	@Column('varchar', { length: 128, nullable: true })
	public district: string | null;

	@Column('varchar', { length: 128, nullable: true })
	public city: string | null;

	@Column('varchar', { length: 2, default: 'HK' })
	public country: string;

	@Index()
	@Column('double precision', { nullable: true })
	public lat: number | null;

	@Index()
	@Column('double precision', { nullable: true })
	public lng: number | null;

	@Index()
	@Column('varchar', { length: 256, nullable: true, comment: 'Google place id (Reclub externalId).' })
	public externalId: string | null;

	@Column('varchar', { length: 256, nullable: true, comment: 'AMap place id (mainland China).' })
	public amapPlaceId: string | null;

	@Column('varchar', { length: 16, default: 'community' })
	public source: typeof venueSources[number];

	@Column('varchar', { length: 64, nullable: true, comment: 'League tenant (hkpl tenant id) that curates this venue.' })
	public curatedByTenant: string | null;

	@Column('varchar', { length: 64, nullable: true, comment: 'The curating tenant\'s own row id (hkpl Venue.id).' })
	public externalRef: string | null;

	@Index()
	@Column('varchar', { length: 16, default: 'under_review' })
	public status: typeof venueStatuses[number];

	@Column({ ...id(), nullable: true, comment: 'Staff-assigned venue owner (Reclub venue-owner screen).' })
	public ownerUserId: MiUser['id'] | null;

	@Column('integer', { nullable: true })
	public courtCount: number | null;

	@Column('varchar', { length: 2048, nullable: true })
	public notes: string | null;

	@Column({ ...id(), nullable: true })
	public createdById: MiUser['id'] | null;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public createdAt: Date;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}
