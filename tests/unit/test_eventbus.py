import asyncio

from rubberduck.eventbus import EventBus


def test_publish_stamps_id_and_ts() -> None:
    bus = EventBus()
    event = bus.publish({"event_type": "Stop", "session_key": "s1"})
    assert event["session_key"] == "s1"
    assert len(event["_id"]) == 32
    assert isinstance(event["_ts"], int)


def test_publish_does_not_mutate_caller_dict() -> None:
    bus = EventBus()
    raw = {"event_type": "Stop"}
    bus.publish(raw)
    assert "_id" not in raw


def test_ring_evicts_oldest_past_capacity() -> None:
    bus = EventBus(capacity=3)
    for i in range(5):
        bus.publish({"n": i})
    assert [e["n"] for e in bus.recent()] == [2, 3, 4]


def test_recent_limit_returns_tail() -> None:
    bus = EventBus(capacity=10)
    for i in range(10):
        bus.publish({"n": i})
    assert [e["n"] for e in bus.recent(limit=2)] == [8, 9]


def test_subscriber_receives_event_published_after_subscribe() -> None:
    async def scenario() -> str:
        bus = EventBus()
        with bus.subscribe() as sub:
            bus.publish({"n": "after"})
            received = await asyncio.wait_for(sub.next(), 1)
        return str(received["n"])

    assert asyncio.run(scenario()) == "after"


def test_event_published_between_subscribe_and_read_is_not_lost() -> None:
    # Regression: the queue must register at subscribe(), not at first read.
    async def scenario() -> list[str]:
        bus = EventBus()
        with bus.subscribe() as sub:
            bus.publish({"n": "first"})
            bus.publish({"n": "second"})
            a = await asyncio.wait_for(sub.next(), 1)
            b = await asyncio.wait_for(sub.next(), 1)
        return [str(a["n"]), str(b["n"])]

    assert asyncio.run(scenario()) == ["first", "second"]


def test_subscriber_removed_on_close() -> None:
    bus = EventBus()
    sub = bus.subscribe()
    assert bus.subscriber_count == 1
    sub.close()
    assert bus.subscriber_count == 0
