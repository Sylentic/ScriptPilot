from sqlmodel import SQLModel, create_engine, Session

DATABASE_URL = "sqlite:///scripts.db"
engine = create_engine(DATABASE_URL, echo=True)

def create_db_and_tables():
    SQLModel.metadata.create_all(engine)

def get_session():
    """Regular session for context manager usage"""
    return Session(engine)

def get_db_session():
    """Generator function for FastAPI dependency injection"""
    session = Session(engine)
    try:
        yield session
    finally:
        session.close()
