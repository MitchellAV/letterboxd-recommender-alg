const math = require("mathjs");
const Movie = require("../models/movie");
const User = require("../models/user");

const { cosine_similarity } = require("./recommendation-functions");

const new_or_update_user = () => {};
const reset_user_recommendations = async (username) => {
	try {
		await Movie.aggregate([
			{
				$set: {
					score: {
						$filter: {
							input: "$score",
							as: "user",
							cond: {
								$not: {
									$eq: ["$$user._id", username]
								}
							}
						}
					}
				}
			}
		]);

		await Movie.updateMany(
			{ "score._id": { $not: { $eq: username } } },
			{
				$addToSet: {
					score: {
						_id: username,
						score: 0,
						maxTag: null,
						userRating: null
					}
				}
			}
		);
	} catch (err) {
		console.log(err);
	}
};

const get_user_movie_tags = async (user_movie_ids, tag_blacklist) => {
	let user_tags = await Movie.aggregate([
		{
			$match: {
				$expr: {
					$in: ["$_id", user_movie_ids]
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
			$set: {
				idf: {
					$log10: {
						$divide: [user_movie_ids.length, "$count"]
					}
				}
			}
		}
	]);
	let user_tag_map = new Map();

	user_tags.forEach((tag) => {
		user_tag_map.set(tag._id, tag.idf);
	});

	user_tags = user_tags.sort((a, b) => a.idf - b.idf);
	user_tags = user_tags.filter((tag) => !tag_blacklist.includes(tag._id));
	user_tags = user_tags.slice(0, 500);
	user_tags = user_tags.map((tag) => tag._id);

	return [user_tags, user_tag_map];
};

const determine_accuracy = async (
	username,
	accuracy,

	tag_blacklist
) => {
	// let all_movies_tags = await User.aggregate([
	// 	{
	// 		$match: {
	// 			_id: username
	// 		}
	// 	},
	// 	{
	// 		$project: {
	// 			movies: 1
	// 		}
	// 	},
	// 	{
	// 		$unwind: {
	// 			path: "$movies"
	// 		}
	// 	},
	// 	{
	// 		$lookup: {
	// 			from: "movies",
	// 			localField: "movies._id",
	// 			foreignField: "_id",
	// 			as: "movies"
	// 		}
	// 	},
	// 	{
	// 		$match: {
	// 			$expr: {
	// 				$not: {
	// 					$eq: [
	// 						{
	// 							$size: "$movies"
	// 						},
	// 						0
	// 					]
	// 				}
	// 			}
	// 		}
	// 	},
	// 	{
	// 		$set: {
	// 			movies: {
	// 				$arrayElemAt: ["$movies", 0]
	// 			}
	// 		}
	// 	},
	// 	{
	// 		$lookup: {
	// 			from: "tags",
	// 			localField: "movies.tags",
	// 			foreignField: "_id",
	// 			as: "movies"
	// 		}
	// 	},
	// 	{
	// 		$unwind: {
	// 			path: "$movies"
	// 		}
	// 	},
	// 	{
	// 		$group: {
	// 			_id: "$_id",
	// 			tags: {
	// 				$addToSet: "$movies"
	// 			}
	// 		}
	// 	},
	// 	{
	// 		$project: {
	// 			"tags._id": 1,
	// 			"tags.count": 1,
	// 			"tags.idf": 1
	// 		}
	// 	}
	// ]);
	all_movies_tags = all_movies_tags[0].tags;
	// gets all user tags with idf of all movies

	all_movies_tags = all_movies_tags.sort((a, b) => a.idf - b.idf);
	// all_movies_tags = all_movies_tags.filter(
	// 	(tag) => (tag.count / movies.length) * 100 <= 5
	// );
	all_movies_tags = all_movies_tags.filter(
		(tag) => !tag_blacklist.includes(tag._id)
	);
	// switch (accuracy) {
	// 	case "high":
	// 		break;
	// 	case "med":
	// 		all_movies_tags = all_movies_tags.filter(
	// 			(tag) => (tag.count / movies.length) * 100 >= 0.5
	// 		);
	// 		break;
	// 	case "low":
	// 		all_movies_tags = all_movies_tags.filter(
	// 			(tag) => (tag.count / movies.length) * 100 >= 1
	// 		);
	// 		break;

	// 	default:
	// 		break;
	// }
	function getRandom(arr, n) {
		let result = new Array(n),
			len = arr.length,
			taken = new Array(len);
		if (n > len)
			throw new RangeError(
				"getRandom: more elements taken than available"
			);
		while (n--) {
			const x = Math.floor(Math.random() * len);
			result[n] = arr[x in taken ? taken[x] : x];
			taken[x] = --len in taken ? taken[len] : len;
		}
		return result;
	}
	all_movies_tags = all_movies_tags.slice(0, 500);
	all_movies_tags = all_movies_tags.map((tag) => tag._id);

	let all_movies_tags_map = new Map();
	all_movies_tags.forEach((tag, i) => {
		all_movies_tags_map.set(tag, i);
	});
	return [all_movies_tags, all_movies_tags_map];
};
const calc_tfidf = (
	username,
	movie,
	all_movies_tags,
	all_movies_tags_map,
	all_movies_average,
	search_vector
) => {
	let movieVector = math.matrix(
		math.zeros([1, all_movies_tags.length]),
		"sparse"
	);
	movie.tags.forEach((tag) => {
		const index = all_movies_tags_map.get(tag._id);
		if (index !== undefined) {
			// movieavgrating
			let tfidf = tag.idf;
			let corrected_vote_average =
				(movie.vote_count * movie.vote_average +
					movie.vote_average +
					0) /
				(movie.vote_count + 2);
			let ratingWeight = Math.pow(
				corrected_vote_average / all_movies_average,
				5
			);

			movieVector.set([0, index], tfidf * ratingWeight);
		}
	});
	let { score, maxIndex } = cosine_similarity(search_vector, movieVector);

	// try {
	// 	await Movie.updateOne(
	// 		{ _id: movie._id, "score._id": username },
	// 		{
	// 			"score.$.score": score,
	// 			"score.$.maxTag": all_movies_tags[maxIndex]
	// 		}
	// 	);
	// } catch (err) {
	// 	console.error(err);
	// }
	return {
		updateOne: {
			filter: { _id: movie._id, "score._id": username },
			update: {
				"score.$.score": score,
				"score.$.maxTag": all_movies_tags[maxIndex]
			}
		}
	};
};
module.exports = {
	new_or_update_user,
	reset_user_recommendations,
	get_user_movie_tags,
	determine_accuracy,
	calc_tfidf
};
