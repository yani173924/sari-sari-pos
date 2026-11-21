const express = require('express');
const { requireRole } = require('../middleware/auth');
const ctrl = require('../controllers/adminController');

const router = express.Router();
router.use(requireRole('admin'));

router.get('/dashboard', ctrl.dashboard);
router.get('/api/sales-chart', ctrl.salesChartData);

router.get('/products', ctrl.listProducts);
router.post('/products', ctrl.createProduct);
router.post('/products/:id', ctrl.updateProduct);
router.post('/categories', ctrl.createCategory);
router.post('/categories/:id', ctrl.updateCategory);
router.post('/categories/:id/delete', ctrl.deleteCategory);

router.get('/users', ctrl.listUsers);
router.post('/users', ctrl.createUser);
router.post('/users/:id/toggle-active', ctrl.toggleUserActive);

router.get('/sales', ctrl.listSales);
router.get('/sales/:id', ctrl.viewSale);

router.get('/daily-report', ctrl.dailySalesReport);
router.get('/inventory-reports', ctrl.listInventoryReports);

module.exports = router;
