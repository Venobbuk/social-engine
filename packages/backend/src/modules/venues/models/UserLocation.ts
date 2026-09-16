/*
 * SPDX-FileCopyrightText: silkvo social-engine contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { Entity, Column, PrimaryColumn, Index, ManyToOne, JoinColumn } from 'typeorm';
import { id } from '@/models/util/id.js';
import { MiUser } from '@/models/User.js';

export const userLocationKinds = ['home', 'work', 'favourite'] as const;

/**
 * VENUE-V1 (W4, decision D14): Reclub `settings:locations` — the saved places a player discovers from (home, work,
 * favourites). Discovery itself is location-based: the client sends lat/lng/radius from one of these, or from the
 * device's current location, or none (global). Nothing here is a "community border".
 */
@Entity('user_location')
export class MiUserLocation {
	@PrimaryColumn(id())
	public id: string;

	@Index()
	@Column(id())
	public userId: MiUser['id'];

	@ManyToOne(() => MiUser, { onDelete: 'CASCADE' })
	@JoinColumn()
	public user: MiUser | null;

	@Column('varchar', { length: 16, default: 'favourite' })
	public kind: typeof userLocationKinds[number];

	@Column('varchar', { length: 128 })
	public label: string;

	@Column('varchar', { length: 512, nullable: true })
	public address: string | null;

	@Column('double precision')
	public lat: number;

	@Column('double precision')
	public lng: number;

	@Column('integer', { default: 20, comment: 'Reclub SEARCH_DISTANCE_KM max 80; radius the player last used here.' })
	public radiusKm: number;

	@Column('timestamp with time zone', { default: () => 'now()' })
	public updatedAt: Date;
}
