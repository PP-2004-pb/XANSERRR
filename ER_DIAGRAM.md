# Smart ITAM ER Diagram

This diagram reflects the MongoDB/Mongoose models in `backend/src/models.js`.
`_id` is MongoDB's primary key unless marked otherwise. Fields shown are the
main identifiers and relationship fields; timestamps and less central fields
are omitted for readability.

Rendered vector image: [ER_DIAGRAM.svg](ER_DIAGRAM.svg).

```mermaid
erDiagram
    ASSET {
        ObjectId _id PK
        string assetId UK
        string name
        string category
        string type
        string serialNumber
        string tagId
        string assetGroup
        string department
        string location
        string status
    }

    USER {
        ObjectId _id PK
        string name
        string email UK
        string role
        string department
        boolean isActive
    }

    TRANSACTION {
        ObjectId _id PK
        string transactionId UK
        string type
        ObjectId borrower FK
        string borrowerName
        string status
        date dueDate
        number assetCount
        number returnedCount
    }

    TRANSACTION_ITEM {
        ObjectId _id PK
        ObjectId transaction FK
        ObjectId asset FK
        string assetId
        string status
        date returnedAt
    }

    MOVEMENT {
        ObjectId _id PK
        ObjectId asset FK
        ObjectId transactionId FK
        string assetId
        string action
        string method
        string actor
        object from
        object to
    }

    PM {
        ObjectId _id PK
        ObjectId asset FK
        string assetId
        date date
        string operator
        string result
        date nextPMDate
    }

    REPAIR {
        ObjectId _id PK
        ObjectId asset FK
        string assetId
        date date
        string symptom
        string resolution
        number cost
        string status
    }

    WORK_ORDER {
        ObjectId _id PK
        string workOrderId UK
        ObjectId asset FK
        string assetId
        string type
        string title
        string priority
        string status
        string assignedTo
        date dueDate
    }

    AUDIT {
        ObjectId _id PK
        string actor
        string action
        string assetId
        Mixed before
        Mixed after
    }

    COUNTER {
        string _id PK
        number value
    }

    ASSET_GROUP {
        ObjectId _id PK
        string prefix UK
        string name
    }

    ASSET_CATEGORY {
        ObjectId _id PK
        string name UK
    }

    DEPARTMENT {
        ObjectId _id PK
        string name UK
    }

    LOCATION {
        ObjectId _id PK
        string name
        string building
        string floor
        string department
    }

    USER o|--o{ TRANSACTION : borrower
    ASSET ||--o{ TRANSACTION_ITEM : contains
    TRANSACTION ||--o{ TRANSACTION_ITEM : contains
    ASSET ||--o{ MOVEMENT : has
    TRANSACTION o|--o{ MOVEMENT : "optional transaction ref"
    ASSET ||--o{ PM : has
    ASSET ||--o{ REPAIR : has
    ASSET ||--o{ WORK_ORDER : has

    ASSET_GROUP o|..o{ ASSET : "assetGroup matches prefix"
    ASSET_CATEGORY o|..o{ ASSET : "category matches name"
    DEPARTMENT o|..o{ ASSET : "department string match"
    DEPARTMENT o|..o{ USER : "department string match"
    LOCATION o|..o{ ASSET : "location string match"
```

## Relationship notes

- Solid relationships are Mongoose `ObjectId` references declared with `ref`.
- Dashed relationships are logical matches between strings. The schema does
  not enforce them as foreign keys, so values can exist without a matching
  catalog record.
- `Transaction.borrower` is an optional `User` reference. Transactions also
  store `borrowerName` as a snapshot string.
- `Movement.transactionId` is an optional reference; movement records also
  store `assetId` as a denormalized string. Its `from` and `to` objects each
  hold `floor`, `department`, and `location` strings.
- `TransactionItem` is the join collection between transactions and assets.
- `PM` means preventive maintenance. Its checklist and work-order checklists
  are embedded arrays, not separate collections.
- `Audit.assetId` is a string rather than an `Asset` reference. `Counter` is
  an independent string-keyed collection used to generate identifiers.
- The model schemas use `createdAt` and `updatedAt` timestamps, except
  `Counter`.
