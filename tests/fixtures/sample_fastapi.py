from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

router = APIRouter()

@router.post("/items/{item_id}/buy")
async def purchase_item(item_id: int, user = Depends(get_current_user), db: Session = Depends(get_db)):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    if item.stock < 1:
        raise HTTPException(status_code=400, detail="Out of stock")

    item.stock -= 1
    db.commit()
    await notification_broker.send_purchase_alert(user.email, item.name)
    return {"status": "success", "remaining_stock": item.stock}
