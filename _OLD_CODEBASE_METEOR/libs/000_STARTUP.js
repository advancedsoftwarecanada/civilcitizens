// @ts-nocheck
/* global Posts */

if (Meteor.isClient) {


}

if (Meteor.isServer) {
	Meteor.startup(async () => {
		try {
			// Create indexes if not present
			if (Posts && Posts.rawCollection) {
				await Posts.rawCollection().createIndex({ province: 1, chamber: 1, type: 1, draft: 1, createdAt: -1 });
				await Posts.rawCollection().createIndex({ jurisdiction: 1 });
			}

			// Backfill jurisdiction for existing posts without it
			const missingJurisdiction = await Posts.find({ jurisdiction: { $exists: false } }, { fields: { _id: 1, type: 1, province: 1 } }).fetchAsync();
			for (const p of missingJurisdiction) {
				let j = 'citizen';
						if (p.type === 'chamber') {
							// Current system uses federal EDAs for chambers
							j = 'federal';
						} else if (p.type === 'self' || p.type === 'topic') {
					j = 'citizen';
				}
				await Posts.updateAsync({ _id: p._id }, { $set: { jurisdiction: j } });
			}
			if (missingJurisdiction.length) {
				console.log(`Migration: Backfilled jurisdiction for ${missingJurisdiction.length} posts`);
			}

			// Normalize old image arrays that may store just string IDs to {id,url}
			try {
				const { ApiFiles } = await import('/libs/apiFiles.js');
				const needsNormalization = await Posts.find({ images: { $exists: true, $ne: [] } }, { fields: { _id: 1, images: 1 } }).fetchAsync();
				const cdn = Meteor.settings.public && Meteor.settings.public.cdnPath;
				for (const p of needsNormalization) {
					if (Array.isArray(p.images) && p.images.length && typeof p.images[0] === 'string') {
						const ids = p.images;
						const files = await ApiFiles.find({ _id: { $in: ids } }).fetchAsync();
						const norm = ids.map(id => {
							const f = files.find(x => x && x._id === id) || {};
							const url = f.url || (cdn && f.filePath ? `${cdn}${f.filePath}` : null);
							return url ? { id, url } : null;
						}).filter(Boolean);
						if (norm.length) await Posts.updateAsync({ _id: p._id }, { $set: { images: norm } });
					}
				}
			} catch (e) {
				console.warn('Image normalization skipped/failed:', e && e.message);
			}
		} catch (e) {
			console.warn('Startup migration/indexing error:', e && e.message || e);
		}
	});
}