"""
The marks index.
"""

from datetime import datetime
import pathlib
import time
from typing import Generator

from src.model.comment import Comment


class Marks:
    """
    Class responsible for maintaining user marks like comments.
    """

    def __init__(self, path: pathlib.Path):
        """
        Constructor.

        Args:
            path: The path on disk where the data is stored.
        """
        self.base = path / "marks"

        # TODO
        # Currently all comments are just serialized to a csv file. This is only
        # used for frontend development and should be replaced with something
        # that scales better.
        self.comments_path = path / "all_comments.txt"
        self._init_backing_store()

    def get(
        self,
        start_dt: datetime,
        end_dt: datetime,
        tags: list[str],
        max_hits: int = 20,
    ) -> list[Comment]:
        """
        Get the comments in the start/end range.

        Args:
            start_dt: The start datetime range.
            end_dt: The end datetime range.
            tags: The tags to filter by.
            max_hits: The max number of items to return.
        """
        start_str = start_dt.isoformat()
        end_str = end_dt.isoformat()
        comments = []
        for comment in self._get_all_comments(self.comments_path):
            if comment.date < start_str:
                continue
            if comment.date > end_str:
                break
            if all(tag in comment.tags for tag in tags):
                comments.append(comment)
            if len(comments) >= max_hits:
                break

        return comments

    def create(self, comment: Comment) -> Comment:
        """
        Create a new comment.

        Args:
            comment: The comment to create.

        Returns The comment that was created.
        """
        if (
            ";" in comment.text
            or ";" in comment.date
            or any(";" in tag for tag in comment.tags)
        ):
            raise ValueError("Fields may not contain semicolons")

        # Create a unique enough ID.
        comment.id = time.time_ns()

        comments = [n for n in self._get_all_comments(self.comments_path)]
        i = 0
        for n in comments:
            if n.date > comment.date:
                break
            i += 1
        comments.insert(i, comment)
        self._write_comments(self.comments_path, comments)

        return comment

    def update(self, comment: Comment) -> Comment:
        """
        Update the provided comment.

        Args:
            comment: The comment to update.

        Returns The comment that was created.
        """
        if (
            ";" in comment.text
            or ";" in comment.date
            or any(";" in tag for tag in comment.tags)
        ):
            raise ValueError("Fields may not contain semicolons")

        comments = [n for n in self._get_all_comments(self.comments_path)]
        i = 0
        for n in comments:
            if n.id > comment.id:
                break
            i += 1
        if i >= len(comments):
            raise ValueError("No comment found with that ID")
        comments[i] = comment
        self._write_comments(self.comments_path, comments)

        return comment

    def delete(self, comment_id: int):
        """
        Update the provided comment.

        Args:
            comment: The comment to update.

        Returns The comment that was created.
        """
        comments = [n for n in self._get_all_comments(self.comments_path)]
        i = 0
        for n in comments:
            if n.id == comment_id:
                break
            i += 1
        if i >= len(comments):
            raise ValueError("No comment found with that ID")
        del comments[i]
        self._write_comments(self.comments_path, comments)

    def _get_all_comments(self, path: pathlib.Path) -> Generator[Comment, None, None]:
        """
        Generator to yield all of the raw comments at a particular path.

        Args:
            path: The path of the comments.
        """
        if not path.is_file():
            return

        with open(path, "r") as f:
            for line in f.readlines():
                line = line.strip()
                if len(line) == 0:
                    continue
                id, date, text, tagstr = line.split(";")
                tags = tagstr.split(",")
                yield Comment(id=int(id), date=date, text=text, tags=tags)

    def _write_comments(self, path: pathlib.Path, comments: list[Comment]):
        """
        Serialize the comments to disk.

        Args:
            path: The path of the comments.
            comments: The comments to write.
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            for comment in comments:
                f.write(
                    "{};{};{};{}\n".format(
                        comment.id,
                        comment.date,
                        comment.text,
                        ",".join(comment.tags),
                    )
                )

    def _init_backing_store(self):
        """
        Validate and initialize the backing store.
        """
        # Ensure the store is not a regular file.
        if self.base.is_file():
            raise ValueError(f"Backing store must be a directory! Got: {self.base}")

        # Create if not exists.
        self.base.mkdir(parents=True, exist_ok=True)
