import { matrix, zeros } from "mathjs";
import Movie from "../models/movie";

import { cosine_similarity } from "./recommendation-functions";
import { Movie } from "../util/types";

export const reset_user_recommendations = async (username: string) => {
  await Movie.updateMany({}, [
    {
      $set: {
        score: {
          $filter: {
            input: "$score",
            as: "user",
            cond: {
              $not: {
                $eq: ["$$user._id", username],
              },
            },
          },
        },
      },
    },
  ]);

  await Movie.updateMany(
    { "score._id": { $not: { $eq: username } } },
    {
      $addToSet: {
        score: {
          _id: username,
          score: 0,
          maxTag: null,
          userRating: null,
        },
      },
    }
  );
};

export const get_user_movie_tags = async (
  user_movie_ids: number[],
  tag_blacklist: string[]
) => {
  let user_tags: { _id: string; idf: number }[] = await Movie.aggregate([
    {
      $match: {
        $expr: {
          $in: ["$_id", user_movie_ids],
        },
      },
    },
    {
      $unwind: {
        path: "$tags",
      },
    },
    {
      $group: {
        _id: "$tags",
        count: {
          $sum: 1,
        },
      },
    },
    {
      $set: {
        idf: {
          $log10: {
            $divide: [user_movie_ids.length, "$count"],
          },
        },
      },
    },
  ]);
  let user_tag_map = new Map<string, number>();

  user_tags.forEach((tag) => {
    user_tag_map.set(tag._id, tag.idf);
  });

  user_tags = user_tags.sort((a, b) => a.idf - b.idf);
  user_tags = user_tags.filter((tag) => !tag_blacklist.includes(tag._id));
  user_tags = user_tags.slice(0, 1000);
  const user_tags_terms = user_tags.map((tag) => tag._id);
  return [user_tags_terms, user_tag_map];
};

export const calc_tfidf = (
  username: string,
  movie: Movie,
  all_movies_tags: string[],
  all_movies_tags_map: Map<string, number>,
  all_movies_average: number,
  search_vector
) => {
  let movieVector = matrix(zeros([1, all_movies_tags.length]), "sparse");
  movie.tags.forEach((tag) => {
    const index = all_movies_tags_map.get(tag._id);
    if (index !== undefined) {
      let tfidf = tag.idf;
      let corrected_vote_average =
        (movie.vote_average * (movie.vote_count + 1)) / (movie.vote_count + 2);

      const correction = corrected_vote_average - all_movies_average;
      let ratingWeight = 0;
      if (correction >= 0) ratingWeight = Math.exp(correction);

      movieVector.set([0, index], tfidf * ratingWeight);
    }
  });
  let { score, maxIndex } = cosine_similarity(search_vector, movieVector);

  return {
    updateOne: {
      filter: { _id: movie._id, "score._id": username },
      update: {
        "score.$.score": score,
        "score.$.maxTag": all_movies_tags[maxIndex],
      },
    },
  };
};
