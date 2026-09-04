import { Request, Response } from 'express';

export async function checkoutOrder(req: Request, res: Response) {
  const { userId, items } = req.body;
  if (!items || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty" });
  }

  try {
    const user = await UserService.findById(userId);
    if (!user.isActive) {
      return res.status(403).json({ error: "User suspended" });
    }

    const order = await OrderService.createOrder(userId, items);
    const payment = await PaymentGateway.charge({ amount: order.total });

    await OrderService.markAsPaid(order.id, payment.id);
    await EventQueue.publish("order.created", { orderId: order.id });

    return res.status(201).json({ status: "success", orderId: order.id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
