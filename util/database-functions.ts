import Movie from "../models/movie";
import User from "../models/user";

export const update_user_status = async (username, status) => {
	try {
		const data = await User.findByIdAndUpdate(username, { status: status });
		return [data, undefined];
	} catch (err) {
		console.error(err);
		return [undefined, err];
	}
};

export const update_tags = async () => {
	try {
		const total_num_documents = await Movie.countDocuments({});
		await Movie.aggregate([
			{
				$set: {
					tags: {
						$setUnion: ["$keywords", "$cast", "$crew"]
					}
				}
			},
			{
				$unwind: {
					path: "$tags"
				}
			},
			{
				$group: {
					_id: "$tags",
					count: {
						$sum: 1
					}
				}
			},
			{
				$match: {
					count: {
						$gt: 1
					}
				}
			},
			{
				$set: {
					idf: {
						$log10: {
							$divide: [total_num_documents, "$count"]
						}
					}
				}
			},
			{
				$out: "tags"
			}
		]);
	} catch (err) {
		console.error(err);
	}
};
