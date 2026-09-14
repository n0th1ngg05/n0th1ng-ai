from argparse import ArgumentParser

import ormsgpack

from baize.datastructures import ContentType
from kui.asgi import HttpRequest


def parse_args():

    parser = ArgumentParser()

    parser.add_argument(
        "--device",
        default="cuda",
    )

    parser.add_argument(
        "--listen",
        default="127.0.0.1:6202",
    )

    parser.add_argument(
        "--workers",
        type=int,
        default=1,
    )

    parser.add_argument(
        "--model-path",
        default="models",
    )

    return parser.parse_args()


class MsgPackRequest(HttpRequest):

    async def data(
        self,
    ):

        if self.content_type == "application/msgpack":
            return ormsgpack.unpackb(
                await self.body
            )

        return await self.json