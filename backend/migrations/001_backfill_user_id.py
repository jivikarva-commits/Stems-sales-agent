import os
from typing import Dict, List, Tuple

from pymongo import ASCENDING, DESCENDING, MongoClient


MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "stems-sales-agent")


INDEX_SPEC: Dict[str, List[Tuple[List[Tuple[str, int]], Dict]]] = {
    "agents": [
        ([("user_id", ASCENDING), ("type", ASCENDING)], {"unique": True, "name": "uq_agents_user_type"}),
    ],
    "campaigns": [
        ([("user_id", ASCENDING), ("id", ASCENDING)], {"unique": True, "name": "uq_campaigns_user_id"}),
    ],
    "contacts": [
        ([("user_id", ASCENDING), ("id", ASCENDING)], {"name": "idx_contacts_user_id"}),
    ],
    "leads": [
        ([("user_id", ASCENDING), ("id", ASCENDING)], {"name": "idx_leads_user_id"}),
        ([("user_id", ASCENDING), ("campaign_id", ASCENDING)], {"name": "idx_leads_user_campaign"}),
    ],
    "conversations": [
        ([("user_id", ASCENDING), ("userId", ASCENDING), ("timestamp", DESCENDING)], {"name": "idx_conversations_user"}),
    ],
    "userprofiles": [
        ([("user_id", ASCENDING), ("userId", ASCENDING)], {"unique": True, "name": "uq_userprofiles_user"}),
    ],
    "messages": [
        ([("user_id", ASCENDING), ("created_at", DESCENDING)], {"name": "idx_messages_user_created"}),
    ],
    "emaillogs": [
        ([("user_id", ASCENDING), ("sentAt", DESCENDING)], {"name": "idx_emaillogs_user_sent"}),
    ],
    "calllogs": [
        ([("user_id", ASCENDING), ("createdAt", DESCENDING)], {"name": "idx_calllogs_user_created"}),
    ],
    "reports": [
        ([("user_id", ASCENDING), ("id", ASCENDING)], {"unique": True, "name": "uq_reports_user_id"}),
    ],
    "whatsapp_configs": [
        ([("user_id", ASCENDING)], {"unique": True, "name": "uq_whatsapp_configs_user"}),
    ],
}


def backfill_user_id(coll) -> int:
    query = {
        "owner_email": {"$type": "string", "$ne": ""},
        "$or": [{"user_id": {"$exists": False}}, {"user_id": None}, {"user_id": ""}],
    }
    result = coll.update_many(
        query,
        [
            {
                "$set": {
                    "owner_email": {"$toLower": "$owner_email"},
                    "user_id": {"$toLower": "$owner_email"},
                }
            }
        ],
    )
    return int(result.modified_count)


def ensure_indexes(db, collection_name: str) -> None:
    if collection_name not in INDEX_SPEC:
        return
    coll = db[collection_name]
    if collection_name == "userprofiles":
        try:
            coll.drop_index("userId_1")
        except Exception:
            pass
    for keys, kwargs in INDEX_SPEC[collection_name]:
        try:
            coll.create_index(keys, **kwargs)
        except Exception as exc:
            print(f"[warn] {collection_name}: failed creating index {kwargs.get('name', keys)} -> {exc}")


def main() -> None:
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    existing = set(db.list_collection_names())

    print(f"Running migration on db={DB_NAME}")
    touched = 0
    total_updated = 0

    for name in INDEX_SPEC.keys():
        if name not in existing:
            print(f"[skip] {name}: collection not found")
            continue
        touched += 1
        updated = backfill_user_id(db[name])
        total_updated += updated
        print(f"[ok] {name}: backfilled {updated} documents")
        ensure_indexes(db, name)

    print(f"Done. Collections touched={touched}, documents updated={total_updated}")


if __name__ == "__main__":
    main()
