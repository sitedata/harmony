import { DurationPrecision, MetadataProvider } from './abstract.ts';
import { parseISODateTime, PartialDate } from '../utils/date.ts';
import { ResponseError } from '../utils/errors.ts';
import { isValidGTIN } from '../utils/gtin.ts';

import type {
	ArtistCreditName,
	Artwork,
	ArtworkType,
	CountryCode,
	GTIN,
	HarmonyMedium,
	HarmonyRelease,
	LinkType,
	ReleaseOptions,
} from '../harmonizer/types.ts';

export default class iTunesProvider extends MetadataProvider<ReleaseResult> {
	readonly name = 'iTunes';

	readonly supportedUrls = new URLPattern({
		hostname: '(itunes|music).apple.com',
		pathname: String.raw`/:country(\w{2})?/album/:blurb?/:id(\d+)`,
	});

	readonly launchDate: PartialDate = {
		year: 2003,
		month: 4,
		day: 28,
	};

	readonly durationPrecision = DurationPrecision.MS;

	readonly artworkQuality = 3000;

	constructReleaseUrl(id: string, region: CountryCode = 'US'): URL {
		return new URL([region.toLowerCase(), 'album', id].join('/'), 'https://music.apple.com');
	}

	protected getRawReleaseById(id: string, options?: ReleaseOptions): Promise<ReleaseResult> {
		return this.query(`lookup?id=${id}&entity=song`, options?.regions);
	}

	protected getRawReleaseByGTIN(gtin: GTIN, options?: ReleaseOptions): Promise<ReleaseResult> {
		return this.query(`lookup?upc=${gtin}&entity=song`, options?.regions);
	}

	protected convertRawRelease(rawRelease: ReleaseResult, options?: ReleaseOptions): HarmonyRelease {
		const collection = rawRelease.results.find((result) => result.wrapperType === 'collection') as Collection;
		const tracks = rawRelease.results.filter((result) => result.wrapperType === 'track') as Track[];
		const linkTypes: LinkType[] = [];

		// TODO: check whether release is downloadable
		if (tracks.every((track) => track.isStreamable)) {
			linkTypes.push('paid streaming');
		}

		return {
			title: collection.collectionName,
			artists: [this.convertRawArtist(collection.artistName, collection.artistViewUrl)],
			gtin: this.extractGTINFromUrl(collection.artworkUrl100),
			externalLinks: [{
				url: this.cleanViewUrl(collection.collectionViewUrl),
				types: linkTypes,
			}],
			media: this.convertRawTracklist(tracks, tracks[0].discCount),
			releaseDate: parseISODateTime(collection.releaseDate),
			packaging: 'None',
			images: [this.processImage(collection.artworkUrl100, ['front'])],
		};
	}

	private convertRawTracklist(tracklist: Track[], mediumCount: number): HarmonyMedium[] {
		const media: HarmonyMedium[] = new Array(mediumCount).fill(null).map((_, index) => ({
			format: 'Digital Media',
			number: index + 1,
			tracklist: [],
		}));

		// split flat tracklist into media
		tracklist.forEach((track) => {
			const medium = media[track.discNumber - 1];
			medium.tracklist.push({
				number: track.trackNumber,
				title: track.trackName,
				duration: track.trackTimeMillis,
				artists: [this.convertRawArtist(track.artistName, track.artistViewUrl)],
			});
		});

		return media;
	}

	private convertRawArtist(name: string, url: string): ArtistCreditName {
		return {
			name,
			externalLink: this.cleanViewUrl(url),
		};
	}

	private processImage(url: string, types?: ArtworkType[]): Artwork {
		// transform image URL to point to the source image in its original resolution
		const imageUrl = new URL(url);
		imageUrl.hostname = 'a1.mzstatic.com';
		imageUrl.pathname = imageUrl.pathname.replace(/^\/image\/thumb\//, '/us/r1000/063/');
		const pathComponents = imageUrl.pathname.split('/');
		if (pathComponents.length === 12) {
			// drop trailing path component which did the image conversion
			imageUrl.pathname = pathComponents.slice(0, -1).join('/');
		}

		return {
			url: imageUrl,
			thumbUrl: new URL(url.replace('100x100bb', '250x250bb')),
			types,
		};
	}

	extractGTINFromUrl(url: string): GTIN | undefined {
		const gtinCandidate = url.match(/\b\d{12,14}\b/)?.[0];
		if (gtinCandidate && isValidGTIN(gtinCandidate)) {
			return gtinCandidate;
		}
	}

	private cleanViewUrl(viewUrl: string) {
		// remove tracking(?) query parameters and blurb before ID
		const url = new URL(viewUrl);
		url.search = '';
		url.pathname = url.pathname.replace(/(?<=\/(artist|album))\/[^/]+(?=\/\d+)/, '');

		return url;
	}

	readonly apiBaseUrl = 'https://itunes.apple.com';

	private async query(path: string, preferredRegions?: CountryCode[]) {
		let apiUrl: URL;

		for (const region of (preferredRegions ?? ['US'])) {
			apiUrl = new URL([region.toLowerCase(), path].join('/'), this.apiBaseUrl);

			const data = await this.fetchJSON(apiUrl);
			if (data.resultCount) {
				return data;
			}
		}

		throw new ResponseError(this.name, 'API returned no results', apiUrl!);
	}
}

type ReleaseResult = {
	resultCount: number;
	results: Array<Collection | Track>;
};

type Collection = {
	wrapperType: 'collection';
	collectionType: 'Album';
	artistId: number;
	collectionId: number;
	amgArtistId: number;
	artistName: string;
	collectionName: string;
	collectionCensoredName: string;
	artistViewUrl: string;
	collectionViewUrl: string;
	artworkUrl60: string;
	artworkUrl100: string;
	collectionPrice: number;
	collectionExplicitness: Explicitness;
	contentAdvisoryRating?: 'Explicit';
	trackCount: number;
	copyright: string;
	country: string;
	currency: string;
	releaseDate: string;
	primaryGenreName: string;
};

type Track = {
	wrapperType: 'track';
	kind: Kind;
	artistId: number;
	collectionId: number;
	trackId: number;
	artistName: string;
	collectionName: string;
	trackName: string;
	collectionCensoredName: string;
	trackCensoredName: string;
	artistViewUrl: string;
	collectionViewUrl: string;
	trackViewUrl: string;
	previewUrl: string;
	artworkUrl30: string;
	artworkUrl60: string;
	artworkUrl100: string;
	collectionPrice: number;
	trackPrice: number;
	releaseDate: string;
	collectionExplicitness: Explicitness;
	trackExplicitness: Explicitness;
	discCount: number;
	discNumber: number;
	trackCount: number;
	trackNumber: number;
	trackTimeMillis: number;
	country: string;
	currency: string;
	primaryGenreName: string;
	isStreamable: boolean;
};

type Explicitness = 'clean' | 'explicit' | 'notExplicit';

type Kind =
	| 'album'
	| 'artist'
	| 'book'
	| 'coached-audio'
	| 'feature-movie'
	| 'interactive-booklet'
	| 'music-video'
	| 'pdf podcast'
	| 'podcast-episode'
	| 'software-package'
	| 'song'
	| 'tv-episode';
